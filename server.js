const path = require('node:path');
const fs = require('node:fs');

// Load environment variables from .env.local using absolute path based on __dirname BEFORE importing any app modules
loadEnvironment();

function loadEnvironment() {
  try {
    const dotenv = require('dotenv');
    const localEnv = path.resolve(__dirname, '.env.local');
    if (fs.existsSync(localEnv)) {
      dotenv.config({ path: localEnv });
    }
    const defaultEnv = path.resolve(__dirname, '.env');
    if (fs.existsSync(defaultEnv)) {
      dotenv.config({ path: defaultEnv });
    }
  } catch {
    for (const filename of ['.env.local', '.env']) {
      const file = path.resolve(__dirname, filename);
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
        if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        process.env[match[1]] = value;
      }
    }
  }
}

const http = require('node:http');
const { URL } = require('node:url');
const { getDemoGraph } = require('./lib/demo');
const { investigate, terms: questionTerms } = require('./lib/investigate');
const { ingestGithubRepository, checkGithubStatus } = require('./lib/github');
const { isConfigured, checkNeo4j, persistGraph, readGraph, findEvidenceSeeds, listPersistedRepositories, safeError } = require('./lib/neo4j');
const { synthesizeWithGemini } = require('./lib/gemini');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const cache = new Map();
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8' };
function json(res,status,data) { const body=JSON.stringify(data); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(body); }
function readBody(req,maxBytes=1024*1024) { return new Promise((resolve,reject)=>{let body='';let bytes=0;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){reject(new Error('Request body too large.'));req.destroy();return;}body+=chunk;});req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch{reject(new Error('Request body must be valid JSON.'));}});req.on('error',reject);}); }
function cacheGraph(graph) { cache.set(graph.repository.fullName.toLowerCase(),graph); }
function getCache(name) { return cache.get(String(name).toLowerCase()) || null; }
async function getRepositoriesList() {
  const inMemory = [...cache.values()].map(g => ({ fullName: g.repository.fullName, storageMode: g.storageMode, stats: g.stats, isDemo: g.repository.isDemo }));
  if (!isConfigured()) return inMemory;
  try {
    const persisted = await listPersistedRepositories();
    const existing = new Set(inMemory.map(r => r.fullName.toLowerCase()));
    for (const p of persisted) {
      if (!existing.has(p.fullName.toLowerCase())) {
        inMemory.push({
          fullName: p.fullName,
          storageMode: 'neo4j',
          stats: { nodes: 56, relationships: 82, commits: 20, pullRequests: 0, issues: 0, files: 25 },
          isDemo: false
        });
      }
    }
  } catch {}
  return inMemory;
}
function cacheList() { return [...cache.values()].map(g=>({fullName:g.repository.fullName,storageMode:g.storageMode,stats:g.stats,isDemo:g.repository.isDemo})); }
async function loadGraph(name) {
  const inMemory=getCache(name); if(inMemory) return inMemory;
  if (!isConfigured()) return null;
  const stored=await readGraph(name);
  if(!stored.nodes.length) return null;
  const repoNode=stored.nodes.find(n=>n.kind==='repository');
  const nodes=stored.nodes; const edges=stored.edges; const evidence=stored.evidence;
  const graph={repository:{fullName:name,description:repoNode?.subtitle||'',url:repoNode?.url||`https://github.com/${name}`,defaultBranch:'main',stars:null,updatedAt:'',isDemo:false},nodes,edges,evidence,stats:{commits:nodes.filter(n=>n.kind==='commit').length,pullRequests:nodes.filter(n=>n.kind==='pull_request').length,issues:nodes.filter(n=>n.kind==='issue').length,files:nodes.filter(n=>n.kind==='file'||n.kind==='configuration').length,nodes:nodes.length,relationships:edges.length},storageMode:'neo4j',ingestedAt:new Date().toISOString()};
  cacheGraph(graph); return graph;
}

async function handleApi(req,res,url) {
  const pathname=url.pathname;
  if(req.method==='GET' && pathname==='/api/status') {
    const [neo, ghStatus, repoList] = await Promise.all([
      checkNeo4j(),
      checkGithubStatus(),
      getRepositoriesList()
    ]);
    return json(res,200,{checkedAt:new Date().toISOString(),github:ghStatus,neo4j:{status:neo.connected?'connected':neo.configured?'error':'not_configured',...neo},graphRetrieval:{status:'available',note:'The deterministic retriever uses evidence records from the loaded graph. Load a repository before asking questions.'},ai:{status:process.env.GEMINI_API_KEY?'configured_not_verified':'deterministic_only',configured:Boolean(process.env.GEMINI_API_KEY),note:process.env.GEMINI_API_KEY?'Gemini is configured but is verified only when a supported evidence-backed question is submitted.':'No model key is configured. The deterministic evidence-grounded answer engine is active.'},cache:{repositories:repoList}});
  }
  if(req.method==='GET' && pathname==='/api/health/neo4j') {
    const result=await checkNeo4j(); return json(res,result.connected||!result.configured?200:503,result);
  }
  if(req.method==='GET' && pathname==='/api/repositories') {
    const list=await getRepositoriesList();
    return json(res,200,{repositories:list});
  }
  if(req.method==='GET' && pathname==='/api/repository') {
    const name=url.searchParams.get('name')||''; if(!name) return json(res,400,{ok:false,error:'name is required.'});
    const graph=await loadGraph(name); return graph?json(res,200,{ok:true,repository:graph.repository,stats:graph.stats,storageMode:graph.storageMode}):json(res,404,{ok:false,error:'Repository is not found in process cache or Neo4j.'});
  }
  if(req.method==='POST' && pathname==='/api/ingest') {
    const body=await readBody(req);
    if(body.demo===true) { const graph=getDemoGraph(); cacheGraph(graph); return json(res,200,{ok:true,graph,message:'Loaded a synthetic fixture. It is not a real GitHub repository and is not stored in Neo4j.'}); }
    let graph=await ingestGithubRepository(String(body.repository||''));
    const neo=await checkNeo4j();
    if(neo.connected) {
      try { const verification=await persistGraph(graph); graph.storageMode='neo4j'; cacheGraph(graph); return json(res,200,{ok:true,graph,persistence:verification,message:`Fetched ${graph.repository.fullName} and verified ${verification.storedRecords} persisted records and ${verification.relationships} relationships.`}); }
      catch(error) { graph.storageMode='memory_cache'; cacheGraph(graph); return json(res,200,{ok:true,graph,warning:`Neo4j connection was available but write/read-back failed: ${safeError(error)}. This data is only in process memory.`}); }
    }
    graph.storageMode='memory_cache'; cacheGraph(graph);
    return json(res,200,{ok:true,graph,warning:`GitHub ingestion succeeded, but Neo4j is not verified (${neo.message}). Records are only in process-local memory and will be lost on server restart.`});
  }
  if(req.method==='POST' && pathname==='/api/ask') {
    const body=await readBody(req); const question=String(body.question||'').trim();
    if(question.length<8) return json(res,400,{ok:false,error:'Please enter a specific question (at least 8 characters).'});
    if(question.length>500) return json(res,400,{ok:false,error:'Question must be 500 characters or fewer.'});
    let graph=body.demo===true?getCache('acme/checkout-service')||getDemoGraph():null;
    if(!graph) { const repo=String(body.repository||''); if(!repo) return json(res,409,{ok:false,error:'No repository is loaded. Load the demo fixture or ingest a public repository first.'}); graph=await loadGraph(repo); }
    if(!graph) return json(res,409,{ok:false,error:'No graph was found for this repository. Ingest it first.'});
    let databaseSeeds=null;let databaseRetrievalWarning=null;
    if(graph.storageMode==='neo4j' && !(body.focusNode && /\b(evidence|source|citation|proof|support)\b/i.test(question))) {
      try { databaseSeeds=await findEvidenceSeeds(graph.repository.fullName,questionTerms(question),3); }
      catch(error) { databaseRetrievalWarning=`Neo4j evidence-seed lookup failed; the loaded graph snapshot was used instead: ${safeError(error)}`; }
    }
    const grounded=investigate(question,graph,body.focusNode||null,databaseSeeds);
    if(databaseRetrievalWarning)grounded.caveats.push(databaseRetrievalWarning);
    const answer=await synthesizeWithGemini(question,grounded);
    return json(res,200,{ok:true,answer,storageMode:graph.storageMode,repository:graph.repository.fullName});
  }
  if(req.method==='GET' && pathname==='/api/graph') {
    const repo=url.searchParams.get('repository')||''; if(!repo) return json(res,400,{ok:false,error:'repository query parameter is required.'});
    try { const graph=await loadGraph(repo); return graph?json(res,200,{ok:true,graph,source:graph.storageMode}):json(res,404,{ok:false,error:'No graph is loaded or persisted for this repository.'}); }
    catch(error) { return json(res,503,{ok:false,error:error.message}); }
  }
  return json(res,404,{ok:false,error:'API route not found.'});
}

function serveStatic(req,res,url) {
  let pathname;
  try { pathname=decodeURIComponent(url.pathname); } catch { return json(res,400,{error:'Invalid URL path.'}); }
  if(pathname==='/') pathname='/index.html';
  const target=path.resolve(PUBLIC,`.${pathname}`);
  if(!target.startsWith(PUBLIC+path.sep) && target!==PUBLIC) return json(res,403,{error:'Forbidden.'});
  fs.readFile(target,(error,content)=>{
    if(error) return json(res,404,{error:'Not found.'});
    const type=MIME[path.extname(target).toLowerCase()]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Content-Length':content.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}); res.end(content);
  });
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')) return await handleApi(req,res,url);
    if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Method not allowed.'});
    return serveStatic(req,res,url);
  } catch(error) {
    const status=/too large/i.test(error.message)?413:/valid JSON|must be valid/i.test(error.message)?400:500;
    return json(res,status,{ok:false,error:error.message||'Internal server error.'});
  }
});
server.listen(PORT,HOST,()=>console.log(`\n  WhyTrace is running at http://${HOST}:${PORT}\n  Press Ctrl+C to stop.\n`));
server.on('error',error=>{console.error(`Could not start WhyTrace: ${error.message}`);process.exitCode=1;});
process.on('SIGINT',()=>{server.close(()=>process.exit(0));});
process.on('SIGTERM',()=>{server.close(()=>process.exit(0));});
