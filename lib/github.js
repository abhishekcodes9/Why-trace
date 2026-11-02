const path = require('node:path');
const fs = require('node:fs');

// Ensure .env.local is loaded even when lib/github.js is imported directly
try {
  const dotenv = require('dotenv');
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(__dirname, '..', f);
    if (fs.existsSync(p)) dotenv.config({ path: p });
  }
} catch {}

const API = 'https://api.github.com';

function getGithubToken() {
  let token = (process.env.GITHUB_TOKEN || '').trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim();
  }
  return token || null;
}

let cachedStatus = null;
let cachedStatusTime = 0;

async function checkGithubStatus(force = false) {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedStatusTime < 5000) {
    return cachedStatus;
  }
  const token = getGithubToken();
  if (!token) {
    const res = {
      status: 'unauthenticated',
      authenticated: false,
      user: null,
      quotaRemaining: null,
      quotaLimit: null,
      rateLimit: null,
      mode: 'public unauthenticated',
      note: 'GitHub token not configured. Ingestion uses public unauthenticated rate limits (60 req/hr).'
    };
    cachedStatus = res;
    cachedStatusTime = now;
    return res;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'WhyTrace-Hackathon-Prototype',
      Authorization: `Bearer ${token}`
    };
    const response = await fetch(`${API}/user`, { headers, signal: controller.signal });
    const remaining = response.headers.get('x-ratelimit-remaining');
    const limit = response.headers.get('x-ratelimit-limit');
    const reset = response.headers.get('x-ratelimit-reset');
    const used = response.headers.get('x-ratelimit-used');
    const quotaRemaining = remaining !== null ? Number(remaining) : null;
    const quotaLimit = limit !== null ? Number(limit) : null;

    if (response.ok) {
      const data = await response.json();
      const login = data.login || 'authenticated';
      const res = {
        status: 'authenticated',
        authenticated: true,
        user: login,
        quotaRemaining,
        quotaLimit,
        rateLimit: {
          remaining: quotaRemaining,
          limit: quotaLimit,
          reset: reset ? Number(reset) : null,
          used: used ? Number(used) : 0
        },
        mode: `authenticated (@${login})`,
        note: `Authenticated as @${login}. Actual API quota: ${quotaRemaining !== null ? quotaRemaining.toLocaleString() : '—'} / ${quotaLimit !== null ? quotaLimit.toLocaleString() : '5,000'} requests remaining.`
      };
      cachedStatus = res;
      cachedStatusTime = now;
      return res;
    } else {
      const res = {
        status: 'authentication_failed',
        authenticated: false,
        user: null,
        quotaRemaining,
        quotaLimit,
        rateLimit: null,
        mode: 'token invalid',
        note: `GitHub API returned ${response.status} ${response.statusText}. Check GITHUB_TOKEN in .env.local.`
      };
      cachedStatus = res;
      cachedStatusTime = now;
      return res;
    }
  } catch (error) {
    return {
      status: 'error',
      authenticated: false,
      user: null,
      quotaRemaining: null,
      quotaLimit: null,
      rateLimit: null,
      mode: 'connection error',
      note: `Failed to contact GitHub API: ${error.message}`
    };
  } finally {
    clearTimeout(timer);
  }
}
function parseRepository(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter a public GitHub repository URL or owner/repository, for example vercel/next.js.');
  let owner = '';
  let repo = '';
  if (/^[\w.-]+\/[\w.-]+$/.test(raw.replace(/\.git$/i, ''))) {
    [owner, repo] = raw.replace(/\.git$/i, '').split('/');
  } else {
    let parsed;
    try {
      const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      parsed = new URL(candidate);
    } catch {
      throw new Error('Enter a valid GitHub repository URL or owner/repository.');
    }
    if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase()) || parsed.username || parsed.password || parsed.port) {
      throw new Error('Only public repositories hosted on github.com are supported.');
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('The GitHub URL must include both an owner and repository name.');
    try {
      owner = decodeURIComponent(parts[0]);
      repo = decodeURIComponent(parts[1]).replace(/\.git$/i, '');
    } catch {
      throw new Error('The GitHub repository path contains invalid encoding.');
    }
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    throw new Error('The repository owner or name contains unsupported characters.');
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}
function boundedEnv(key, fallback, max) { const value = Number(process.env[key] || fallback); return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback; }
async function githubFetch(path) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'WhyTrace-Hackathon-Prototype' };
    const token = getGithubToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API}${path}`, { headers, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub API rate limit reached. Add GITHUB_TOKEN to .env.local or retry later.');
      if (response.status === 404) throw new Error('Repository or resource not found. Check the owner/repository name and confirm it is public.');
      throw new Error(`GitHub API returned ${response.status} ${response.statusText}.`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('GitHub request timed out. Try again with a smaller repository scope.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function githubRawFetch(owner,repo,branch,filePath) {
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const headers = { 'User-Agent': 'WhyTrace-Hackathon-Prototype' };
    const token = getGithubToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const encoded=filePath.split('/').map(encodeURIComponent).join('/');
    const response=await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encoded}`,{signal:controller.signal,headers});
    if(!response.ok)return null;
    return (await response.text()).slice(0,24000);
  } catch { return null; } finally { clearTimeout(timer); }
}
function tags(text) {
  const ignore = new Set(['the','and','for','with','from','this','that','into','when','what','why','how','are','was','were','has','have','its','our','you','not','will','can','all','new']);
  return [...new Set((String(text).toLowerCase().match(/[a-z0-9_-]{3,}/g) || []).filter(t => !ignore.has(t)))].slice(0,35);
}
function artifactId(kind, key) { return `${kind}:${key}`; }
async function ingestGithubRepository(input) {
  const { owner, repo, fullName } = parseRepository(input);
  const issueLimit = boundedEnv('MAX_ISSUES',15,25);
  const [meta, commits, pulls, issueList] = await Promise.all([
    githubFetch(`/repos/${owner}/${repo}`),
    githubFetch(`/repos/${owner}/${repo}/commits?per_page=${boundedEnv('MAX_COMMITS',20,30)}`),
    githubFetch(`/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${boundedEnv('MAX_PULL_REQUESTS',15,25)}`),
    githubFetch(`/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&per_page=${Math.min(60, Math.max(30, issueLimit * 2))}`)
  ]);
  const issues = issueList.filter(item => !item.pull_request).slice(0, issueLimit);
  const canonicalName = meta.full_name || fullName;
  const repoId = artifactId('repository', canonicalName);
  const nodes = [{ id: repoId, kind: 'repository', label: fullName, subtitle: meta.description || 'Public GitHub repository', url: meta.html_url }];
  const edges = []; const evidence = []; const knownDevelopers = new Set();
  function edge(from,to,kind,label) { edges.push({ id: `edge:${edges.length+1}`, from,to,kind,label:label||kind.toLowerCase() }); }
  function addDeveloper(login, artifact) {
    if (!login) return;
    const devId = artifactId('developer',login);
    if (!knownDevelopers.has(login)) { knownDevelopers.add(login); nodes.push({ id:devId,kind:'developer',label:login,subtitle:'GitHub contributor',url:`https://github.com/${login}` }); }
    edge(devId,artifact,'AUTHORED','authored');
  }
  for (const commit of commits) {
    const cId = artifactId('commit',commit.sha); const message = commit.commit.message.split('\n')[0]; const githubLogin = commit.author?.login || null; const author = githubLogin || commit.commit.author?.name || null;
    nodes.push({ id:cId,kind:'commit',label:commit.sha.slice(0,7),subtitle:message,url:commit.html_url,date:commit.commit.author?.date || commit.commit.committer?.date,author });
    edge(repoId,cId,'HAS_COMMIT','contains'); addDeveloper(githubLogin,cId);
    evidence.push({ id:cId,kind:'commit',title:`Commit ${commit.sha.slice(0,7)} — ${message}`,body:commit.commit.message,url:commit.html_url,date:commit.commit.author?.date,author,tags:tags(commit.commit.message) });
  }
  for (const pr of pulls) {
    const pId = artifactId('pull_request',String(pr.number)); const body = pr.body || '';
    nodes.push({ id:pId,kind:'pull_request',label:`PR #${pr.number}`,subtitle:pr.title,url:pr.html_url,date:pr.merged_at || pr.created_at,author:pr.user?.login,body:body.slice(0,1800) });
    edge(repoId,pId,'HAS_PULL_REQUEST','contains'); addDeveloper(pr.user?.login,pId);
    evidence.push({ id:pId,kind:'pull_request',title:`PR #${pr.number} — ${pr.title}`,body,url:pr.html_url,date:pr.merged_at || pr.created_at,author:pr.user?.login,tags:tags(`${pr.title} ${body}`) });
    if (/(because|rationale|trade[- ]?off|we chose|we decided|decision|to avoid|in order to|chosen approach|selected approach)/i.test(`${pr.title} ${body}`)) {
      const dId = artifactId('decision',`pr-${pr.number}`);
      nodes.push({ id:dId,kind:'decision',label:`Decision from PR #${pr.number}`,subtitle:pr.title,date:pr.merged_at || pr.created_at,author:pr.user?.login,confidence:0.55 });
      edge(pId,dId,'SUPPORTS','documents rationale');
      evidence.push({ id:dId,kind:'decision',title:`Potential decision — ${pr.title}`,body,url:pr.html_url,date:pr.merged_at || pr.created_at,author:pr.user?.login,tags:tags(`${pr.title} ${body}`) });
    }
    const refs = [...`${pr.title}\n${body}`.matchAll(/(?:^|[^\w])#(\d+)/g)].map(m => Number(m[1]));
    pr._issueRefs = refs;
  }
  for (const issue of issues) {
    const iId = artifactId('issue',String(issue.number));
    nodes.push({ id:iId,kind:'issue',label:`Issue #${issue.number}`,subtitle:issue.title,url:issue.html_url,date:issue.created_at,author:issue.user?.login,body:(issue.body || '').slice(0,1800) });
    edge(repoId,iId,'HAS_ISSUE','contains'); addDeveloper(issue.user?.login,iId);
    evidence.push({ id:iId,kind:'issue',title:`Issue #${issue.number} — ${issue.title}`,body:issue.body || '',url:issue.html_url,date:issue.created_at,author:issue.user?.login,tags:tags(`${issue.title} ${issue.body || ''}`) });
  }
  // Fetch a small, bounded sample of review and issue comments as real discussion evidence.
  const [prDiscussions, issueDiscussions] = await Promise.all([
    Promise.all(pulls.slice(0,5).map(async pr => {
      const [reviewComments,conversationComments]=await Promise.all([
        githubFetch(`/repos/${owner}/${repo}/pulls/${pr.number}/comments?per_page=10`).catch(()=>[]),
        githubFetch(`/repos/${owner}/${repo}/issues/${pr.number}/comments?per_page=10`).catch(()=>[])
      ]);
      const unique=[...new Map([...reviewComments,...conversationComments].map(c=>[c.id,c])).values()];
      return {parent:artifactId('pull_request',String(pr.number)),comments:unique};
    })),
    Promise.all(issues.slice(0,5).map(async issue => { try { return { parent:artifactId('issue',String(issue.number)), comments:await githubFetch(`/repos/${owner}/${repo}/issues/${issue.number}/comments?per_page=10`) }; } catch { return { parent:artifactId('issue',String(issue.number)), comments:[] }; } }))
  ]);
  for (const group of [...prDiscussions,...issueDiscussions]) for (const comment of group.comments) {
    const body=String(comment.body||'').trim(); if(!body) continue;
    const dId=artifactId('discussion',String(comment.id));
    const parentNode=nodes.find(n=>n.id===group.parent); if(!parentNode) continue;
    const author=comment.user?.login||null;
    nodes.push({id:dId,kind:'discussion',label:parentNode.kind==='pull_request'?`PR #${parentNode.label.replace('PR #','')} review comment`:`${parentNode.label} discussion`,subtitle:body.replace(/\s+/g,' ').slice(0,105),url:comment.html_url||parentNode.url,date:comment.created_at||comment.updated_at,author,body:body.slice(0,1800)});
    edge(group.parent,dId,'DISCUSSES','discussion comment'); addDeveloper(author,dId);
    evidence.push({id:dId,kind:'discussion',title:`Discussion on ${parentNode.label}`,body,url:comment.html_url||parentNode.url,date:comment.created_at||comment.updated_at,author,tags:tags(body)});
  }
  const nodeSet = new Set(nodes.map(n => n.id));
  for (const pr of pulls) {
    const pId = artifactId('pull_request',String(pr.number));
    for (const ref of pr._issueRefs || []) { const iId = artifactId('issue',String(ref)); if (nodeSet.has(iId)) edge(pId,iId,'REFERENCES','references'); }
    const mergedCommit = pr.merge_commit_sha && artifactId('commit',pr.merge_commit_sha);
    if (mergedCommit && nodeSet.has(mergedCommit)) edge(pId,mergedCommit,'RELATED_TO','merged as');
    // Only explicit supersession/revert language creates a supersession relationship.
    const supersededRefs = [...`${pr.title}\n${pr.body || ''}`.matchAll(/(?:supersedes?|replaces?|overrides?|reverts?)\s+#(\d+)/ig)].map(m => Number(m[1]));
    for (const ref of supersededRefs) { const target = artifactId('pull_request',String(ref)); if (nodeSet.has(target)) edge(pId,target,'SUPERSEDES','explicitly supersedes'); }
  }
  const detailed = await Promise.all(commits.slice(0,15).map(async commit => { try { return await githubFetch(`/repos/${owner}/${repo}/commits/${commit.sha}`); } catch { return null; } }));
  const files = new Map(); const symbols = new Map();
  for (const detail of detailed) {
    if (!detail) continue;
    const cId = artifactId('commit', detail.sha);
    const commitNode = nodes.find(n => n.id === cId);
    const detailFiles = (detail.files || []).map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch || null,
      blobUrl: `https://github.com/${owner}/${repo}/blob/${detail.sha}/${f.filename.split('/').map(encodeURIComponent).join('/')}`
    }));
    if (commitNode) {
      commitNode.metadata = {
        ...(commitNode.metadata || {}),
        fullSha: detail.sha,
        stats: detail.stats || { total: 0, additions: 0, deletions: 0 },
        filesCount: detailFiles.length,
        files: detailFiles
      };
    }
    const cEvidence = evidence.find(e => e.id === cId);
    if (cEvidence && detailFiles.length) {
      const summaries = detailFiles.map(f => `• ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})${f.patch ? `\n  Patch:\n  ${f.patch.slice(0, 450)}` : ''}`).join('\n');
      cEvidence.body = `${detail.commit.message}\n\nFiles modified (${detailFiles.length}):\n${summaries}`;
    }

    for (const file of (detail?.files || [])) {
      const fId = artifactId('file',file.filename);
      const patch=String(file.patch||'').slice(0,5000);
      if (!files.has(fId)) {
        const fileUrl=`https://github.com/${owner}/${repo}/blob/${detail.sha}/${file.filename.split('/').map(encodeURIComponent).join('/')}`;
        const fileNode={id:fId,kind:/config|\.env|\.json/i.test(file.filename)?'configuration':'file',label:file.filename.split('/').pop(),subtitle:file.filename,url:fileUrl,date:detail.commit?.author?.date,author:detail.author?.login||null,metadata:{status:file.status,additions:file.additions,deletions:file.deletions,commitSha:detail.sha},preview:patch};
        files.set(fId,fileNode); nodes.push(fileNode);
      } else if(patch && !files.get(fId).preview) { files.get(fId).preview=patch; }
      if (nodes.some(n=>n.id===cId)) edge(cId,fId,'MODIFIES',file.status || 'modifies');
      // Extract only identifiers visible in the returned commit patch; this is not a full AST parse.
      const addedLines=patch.split('\n').filter(line=>line.startsWith('+')&&!line.startsWith('+++'));
      for(const line of addedLines) {
        const fn=line.match(/^\+\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
          || line.match(/^\+\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
        if(fn) {
          const symbol=fn[1];const id=artifactId('function',`${file.filename}#${symbol}`);
          if(!symbols.has(id)){const node={id,kind:'function',label:symbol,subtitle:`function in ${file.filename}`,date:detail.commit?.author?.date,author:detail.author?.login};symbols.set(id,node);nodes.push(node);}
          edge(fId,id,'CONTAINS','contains function');evidence.push({id,kind:'file',title:`Function ${symbol} — ${file.filename}`,body:line.slice(1).trim(),url:detail.html_url,date:detail.commit?.author?.date,author:detail.author?.login,tags:tags(`${symbol} ${file.filename} ${line}`)});
        }
        const key=line.match(/^\+\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\s*=/);
        if(key) {
          const name=key[1];const id=artifactId('configuration',`${file.filename}#${name}`);
          if(!symbols.has(id)){const node={id,kind:'configuration',label:name,subtitle:`configuration key in ${file.filename}`,date:detail.commit?.author?.date,author:detail.author?.login};symbols.set(id,node);nodes.push(node);}
          edge(fId,id,'CONTAINS','contains configuration key');evidence.push({id,kind:'file',title:`Configuration ${name} — ${file.filename}`,body:line.slice(1).trim(),url:detail.html_url,date:detail.commit?.author?.date,author:detail.author?.login,tags:tags(`${name} ${file.filename} ${line}`)});
        }
      }
    }
  }
  for (const file of files.values()) evidence.push({ id:file.id,kind:'file',title:`Changed file — ${file.subtitle}`,body:file.preview||`GitHub commit details show this file was ${file.metadata.status}.`,url:file.url||null,date:file.date||null,author:file.author||null,tags:tags(`${file.subtitle} ${file.preview||''}`) });

  // Ingest a short, bounded selection of Markdown design/ADR documents from the default branch.
  try {
    const tree=await githubFetch(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`);
    const candidates=(tree.tree||[]).filter(item=>item.type==='blob'&&/\.(md|mdx|rst|txt)$/i.test(item.path)&&(/(^|\/)(docs?|adr|adrs|design|architecture|decisions|rfcs?)(\/|$)/i.test(item.path)||/(^|\/)(README|CONTRIBUTING)(\.mdx?)?$/i.test(item.path))).slice(0,5);
    const docs=await Promise.all(candidates.map(async item=>({path:item.path,body:await githubRawFetch(owner,repo,meta.default_branch,item.path)})));
    for(const doc of docs){if(!doc.body)continue;const dId=artifactId('file',doc.path);let node=files.get(dId);if(!node){node={id:dId,kind:'file',label:doc.path.split('/').pop(),subtitle:doc.path,metadata:{role:'design_document'},preview:doc.body.slice(0,5000)};files.set(dId,node);nodes.push(node);}else{node.metadata={...node.metadata,role:'design_document'};node.preview=doc.body.slice(0,5000);}edge(repoId,dId,'RELATED_TO','repository design document');evidence.push({id:dId,kind:'file',title:`Repository document — ${doc.path}`,body:doc.body.slice(0,12000),url:`https://github.com/${owner}/${repo}/blob/${encodeURIComponent(meta.default_branch)}/${doc.path.split('/').map(encodeURIComponent).join('/')}`,tags:tags(`${doc.path} ${doc.body}`)});}
  } catch { /* Tree/markdown retrieval is supplementary; core GitHub records remain available. */ }
  const nodeIds = new Set(nodes.map(n=>n.id));
  const cleanEdges = edges.filter(e=>nodeIds.has(e.from)&&nodeIds.has(e.to));
  const cleanEvidence = [...new Map(evidence.map(record => [record.id, record])).values()];
  return {
    repository:{fullName:canonicalName,description:meta.description||'',url:meta.html_url,defaultBranch:meta.default_branch,stars:meta.stargazers_count,updatedAt:meta.updated_at,isDemo:false},
    nodes,edges:cleanEdges,evidence:cleanEvidence,
    stats:{commits:commits.length,pullRequests:pulls.length,issues:issues.length,files:files.size,nodes:nodes.length,relationships:cleanEdges.length},
    storageMode:'memory_cache',ingestedAt:new Date().toISOString()
  };
}
module.exports = { parseRepository, ingestGithubRepository, checkGithubStatus };
