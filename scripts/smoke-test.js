const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { parseRepository } = require('../lib/github');
const port = 3187 + Math.floor(Math.random() * 300);
const host = '127.0.0.1';
const base = `http://${host}:${port}`;

async function waitForServer(child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}.`);
    try { const response = await fetch(base); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error('Server did not start within 15 seconds.');
}
async function main() {
  assert.equal(parseRepository('vercel/next.js').fullName, 'vercel/next.js');
  assert.equal(parseRepository('https://github.com/vercel/next.js/tree/main').fullName, 'vercel/next.js');
  assert.throws(() => parseRepository('https://gitlab.com/vercel/next.js'), /github.com/i);
  assert.throws(() => parseRepository('https://github.com.evil.example/vercel/next.js'), /github.com/i);
  assert.throws(() => parseRepository('owner-only'), /github.com/i);
  const child = spawn(process.execPath, [path.join(__dirname,'..','server.js')], { cwd:path.join(__dirname,'..'), env:{...process.env,PORT:String(port),HOST:host}, stdio:['ignore','ignore','pipe'] });
  let stderr=''; child.stderr.on('data',chunk=>stderr+=chunk.toString());
  try {
    await waitForServer(child);
    const home = await fetch(base); assert.equal(home.status,200,'Landing page must load');
    const html = await home.text(); assert.match(html,/WhyTrace/); assert.match(html,/Knowledge Graph/);
    const css = await fetch(`${base}/styles.css`); assert.equal(css.status,200,'Stylesheet must be served');
    const js = await fetch(`${base}/app.js`); assert.equal(js.status,200,'Frontend application must be served');

    const ingest = await fetch(`${base}/api/ingest`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({demo:true})});
    assert.equal(ingest.status,200,'Demo ingestion must succeed'); const ingestData=await ingest.json();
    assert.equal(ingestData.ok,true); assert.equal(ingestData.graph.repository.isDemo,true); assert.equal(ingestData.graph.storageMode,'demo_fixture');
    assert.ok(ingestData.graph.nodes.length>=8,'Demo graph must have nodes'); assert.ok(ingestData.graph.edges.length>=7,'Demo graph must have real fixture relationships');

    const graph = await fetch(`${base}/api/graph?repository=acme%2Fcheckout-service`); assert.equal(graph.status,200,'Loaded graph endpoint must return graph'); const graphData=await graph.json(); assert.equal(graphData.graph.repository.isDemo,true);
    const missingGraph = await fetch(`${base}/api/graph?repository=unknown%2Frepo`); assert.equal(missingGraph.status,404,'Unknown graph should return a clear not-found response');

    const ask = await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Why is the retry limit set to 3?',repository:'acme/checkout-service',demo:true})});
    assert.equal(ask.status,200,'Evidence-backed question should be processed'); const askData=await ask.json();
    assert.equal(askData.answer.status,'answered','Demo rationale question should return a grounded answer'); assert.ok(askData.answer.evidence.length>=2,'Answer must cite retrieved fixture evidence'); assert.ok(askData.answer.caveats.some(x=>x.includes('DEMO DATA')),'Demo disclaimer must be present'); assert.ok(askData.answer.path.length>0,'Graph relationships must be traversed'); assert.ok(askData.answer.retrieval.expandedCount>0,'Retrieval must expand beyond lexical seed records');

    const configAsk = await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Why was this configuration introduced?',repository:'acme/checkout-service',demo:true})});
    assert.equal(configAsk.status,200); const configData=await configAsk.json(); assert.equal(configData.answer.status,'answered','Configuration question should reach the connected rationale'); assert.ok(configData.answer.evidence.some(e=>e.kind==='discussion'),'Two-hop traversal should retrieve the connected review discussion');

    const prAsk = await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Which PR introduced this behavior?',repository:'acme/checkout-service',demo:true})});
    assert.equal(prAsk.status,200); const prData=await prAsk.json(); assert.match(prData.answer.answer,/PR #58671/,'PR-specific question should directly identify the retrieved PR');

    const evidenceAsk = await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'What evidence supports this?',repository:'acme/checkout-service',demo:true,focusNode:'file-retry'})});
    assert.equal(evidenceAsk.status,200); const evidenceData=await evidenceAsk.json(); assert.ok(evidenceData.answer.evidence.length>=2,'Evidence-intent query should expand from the selected graph node'); assert.ok(evidenceData.answer.evidence.some(e=>e.kind==='discussion'),'Selected-file evidence should traverse to the review discussion');

    const supersessionAsk = await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Was this decision superseded?',repository:'acme/checkout-service',demo:true})});
    assert.equal(supersessionAsk.status,200); const supersessionData=await supersessionAsk.json(); assert.equal(supersessionData.answer.status,'partial_evidence','No explicit supersession record must not be treated as proof of an active decision'); assert.match(supersessionData.answer.answer,/cannot determine/i);

    const unknown = await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Why was the Kubernetes cluster migrated to SaturnDB?',repository:'acme/checkout-service',demo:true})});
    assert.equal(unknown.status,200); const unknownData=await unknown.json(); assert.equal(unknownData.answer.status,'insufficient_evidence','Unsupported question must abstain'); assert.equal(unknownData.answer.evidence.length,0);

    const noRepoAsk=await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Why does this service use retries?',repository:'unknown/repo'})}); assert.equal(noRepoAsk.status,409,'An unloaded repository should return a conflict response, not a database configuration error');

    const status=await fetch(`${base}/api/status`); assert.equal(status.status,200); const health=await status.json(); assert.ok(health.neo4j); assert.ok(['deterministic_only','configured_not_verified'].includes(health.ai.status));
    const invalid=await fetch(`${base}/api/ask`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'x',demo:true})}); assert.equal(invalid.status,400,'Input validation must reject short questions');
    console.log('PASS GitHub repository URL validation');
    console.log('PASS landing page HTTP response and static assets');
    console.log('PASS demo ingestion and graph structure');
    console.log('PASS graph API returns the loaded fixture and handles missing graphs');
    console.log('PASS grounded retry-limit investigation with evidence');
    console.log('PASS two-hop rationale retrieval for configuration questions');
    console.log('PASS PR-specific question identifies the supporting pull request');
    console.log('PASS selected-node evidence traverses to review discussion');
    console.log('PASS supersession question abstains from unsupported active/inactive claims');
    console.log('PASS unsupported question abstains');
    console.log('PASS unloaded repository investigation response');
    console.log('PASS integration status endpoint');
    console.log('PASS question input validation');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,1000))]);
    if (stderr) process.stderr.write(stderr);
  }
}
main().catch(error=>{console.error(`FAIL ${error.stack||error.message}`);process.exitCode=1;});
