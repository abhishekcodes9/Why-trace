const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { checkGithubStatus, ingestGithubRepository } = require('../lib/github');
const { checkNeo4j, persistGraph, readGraph, listPersistedRepositories } = require('../lib/neo4j');

const port = 3199 + Math.floor(Math.random() * 200);
const host = '127.0.0.1';
const base = `http://${host}:${port}`;

async function waitForServer(child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}.`);
    try { const response = await fetch(base); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Server did not start within 15 seconds.');
}

async function run() {
  console.log('===========================================================');
  console.log('WHYTRACE — GITHUB INTEGRATION & DUAL-REPO VERIFICATION');
  console.log('===========================================================');

  // 1 & 2: Verify lib/github.js reads GITHUB_TOKEN and uses Authorization: Bearer
  console.log('\n[1/7] Testing lib/github.js token reading & authentication...');
  const ghStatus = await checkGithubStatus(true);
  console.log('      GitHub Status:', ghStatus.status);
  console.log('      Authenticated user:', ghStatus.user);
  console.log('      Remaining quota:', ghStatus.quotaRemaining, '/', ghStatus.quotaLimit);
  assert.equal(ghStatus.authenticated, true, 'GitHub status must be authenticated');
  assert.equal(ghStatus.user, 'abhishekcodes9', 'Authenticated user must match token identity');
  assert.ok(ghStatus.quotaRemaining > 0, 'Quota remaining must be positive');
  assert.equal(ghStatus.token, undefined, 'Token must never be included in status object (server-side only)');
  console.log('      ✓ Token read from .env.local and Bearer authentication verified.');

  // Start WhyTrace server
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: host },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => (stderr += chunk.toString()));

  try {
    await waitForServer(child);

    // 3 & 4: System Health check via API
    console.log('\n[2/7] Checking System Health API (/api/status)...');
    const statusRes = await fetch(`${base}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    console.log('      System Health github mode:', statusData.github.mode);
    console.log('      System Health note:', statusData.github.note);
    assert.equal(statusData.github.authenticated, true);
    assert.equal(statusData.github.user, 'abhishekcodes9');
    assert.ok(statusData.github.quotaRemaining > 0);
    // Token must not leak to client
    assert.equal(statusData.github.token, undefined);
    assert.equal(JSON.stringify(statusData).includes(process.env.GITHUB_TOKEN?.trim()), false, 'Token string must not leak in /api/status');
    console.log('      ✓ System Health displays authenticated user and actual API quota. Token is server-side only.');

    // 5 & 7: Ingest abhishekcodes9/SayRight
    console.log('\n[3/7] Ingesting repository 1: abhishekcodes9/SayRight...');
    const ingest1 = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'abhishekcodes9/SayRight' })
    });
    assert.equal(ingest1.status, 200);
    const data1 = await ingest1.json();
    assert.equal(data1.ok, true);
    const g1 = data1.graph;
    console.log(`      Ingested: ${g1.repository.fullName} (commits: ${g1.stats.commits}, PRs: ${g1.stats.pullRequests}, issues: ${g1.stats.issues}, files: ${g1.stats.files}, nodes: ${g1.stats.nodes})`);
    assert.ok(g1.stats.commits > 0, 'SayRight must have commits');
    const sayRightCommitWithDiff = g1.nodes.find(n => n.kind === 'commit' && n.metadata?.files?.length > 0);
    assert.ok(sayRightCommitWithDiff, 'SayRight must have commit diffs');
    console.log(`      ✓ Commit diff verified on ${sayRightCommitWithDiff.label}: ${sayRightCommitWithDiff.metadata.files.length} file diffs present.`);

    // 6 & 7: Ingest vercel/next.js
    console.log('\n[4/7] Ingesting repository 2: vercel/next.js (unrelated public repository)...');
    const ingest2 = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'vercel/next.js' })
    });
    assert.equal(ingest2.status, 200);
    const data2 = await ingest2.json();
    assert.equal(data2.ok, true);
    const g2 = data2.graph;
    console.log(`      Ingested: ${g2.repository.fullName} (commits: ${g2.stats.commits}, PRs: ${g2.stats.pullRequests}, issues: ${g2.stats.issues}, files: ${g2.stats.files}, nodes: ${g2.stats.nodes})`);
    assert.ok(g2.stats.commits > 0, 'Next.js must have commits');
    assert.ok(g2.stats.pullRequests > 0, 'Next.js must have PRs');
    assert.ok(g2.stats.issues > 0, 'Next.js must have issues');
    const nextCommitWithDiff = g2.nodes.find(n => n.kind === 'commit' && n.metadata?.files?.length > 0);
    assert.ok(nextCommitWithDiff, 'Next.js must have commit diffs');
    console.log(`      ✓ Commits (${g2.stats.commits}), PRs (${g2.stats.pullRequests}), issues (${g2.stats.issues}), and diffs verified.`);

    // 8: Verify both repositories persist independently in Neo4j
    console.log('\n[5/7] Verifying independent Neo4j persistence for both repositories...');
    const persisted = await listPersistedRepositories();
    const persistedNames = persisted.map(r => r.fullName.toLowerCase());
    console.log('      Persisted repositories in Neo4j:', persisted.map(r => r.fullName));
    assert.ok(persistedNames.includes('abhishekcodes9/sayright'), 'abhishekcodes9/SayRight must be persisted in Neo4j');
    assert.ok(persistedNames.includes('vercel/next.js'), 'vercel/next.js must be persisted in Neo4j');

    const r1 = await readGraph('abhishekcodes9/SayRight');
    const r2 = await readGraph('vercel/next.js');
    console.log(`      SayRight graph in Neo4j: ${r1.nodes.length} nodes, ${r1.edges.length} edges, ${r1.evidence.length} evidence records.`);
    console.log(`      Next.js graph in Neo4j: ${r2.nodes.length} nodes, ${r2.edges.length} edges, ${r2.evidence.length} evidence records.`);
    assert.ok(r1.nodes.length > 0, 'SayRight must load from Neo4j');
    assert.ok(r2.nodes.length > 0, 'Next.js must load from Neo4j');
    console.log('      ✓ Both repositories persisted independently in Neo4j.');

    // 9: Verify switching repositories does not mix evidence
    console.log('\n[6/7] Verifying evidence isolation between repositories...');
    // SayRight evidence check
    const sayRightUrls = r1.evidence.map(e => e.url || '');
    assert.ok(sayRightUrls.every(u => !u.includes('vercel/next.js')), 'SayRight evidence must not contain vercel/next.js URLs');
    assert.ok(r1.nodes.every(n => !n.url?.includes('vercel/next.js')), 'SayRight nodes must not contain vercel/next.js URLs');

    // Next.js evidence check
    const nextUrls = r2.evidence.map(e => e.url || '');
    assert.ok(nextUrls.every(u => !u.includes('abhishekcodes9/SayRight')), 'Next.js evidence must not contain SayRight URLs');
    assert.ok(r2.nodes.every(n => !n.url?.includes('abhishekcodes9/SayRight')), 'Next.js nodes must not contain SayRight URLs');

    // Test querying SayRight via /api/ask
    const askSayRight = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What commit added the environment example configuration?', repository: 'abhishekcodes9/SayRight' })
    });
    assert.equal(askSayRight.status, 200);
    const askSayRightData = await askSayRight.json();
    assert.ok(askSayRightData.answer.evidence.every(e => !e.url?.includes('vercel/next.js')), 'SayRight query answer must only contain SayRight evidence');

    // Test querying Next.js via /api/ask
    const askNext = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What pull request addresses Turbopack or router behavior?', repository: 'vercel/next.js' })
    });
    assert.equal(askNext.status, 200);
    const askNextData = await askNext.json();
    assert.ok(askNextData.answer.evidence.every(e => !e.url?.includes('abhishekcodes9/SayRight')), 'Next.js query answer must only contain Next.js evidence');
    console.log('      ✓ Complete evidence isolation verified across queries and persistence.');

    // 10: Repositories list endpoint check
    console.log('\n[7/7] Verifying repository switcher API (/api/repositories)...');
    const repoListRes = await fetch(`${base}/api/repositories`);
    assert.equal(repoListRes.status, 200);
    const repoListData = await repoListRes.json();
    const repoNames = repoListData.repositories.map(r => r.fullName.toLowerCase());
    assert.ok(repoNames.includes('abhishekcodes9/sayright'));
    assert.ok(repoNames.includes('vercel/next.js'));
    console.log('      ✓ Repository switcher lists both repositories accurately.');

    console.log('\n===========================================================');
    console.log('ALL INTEGRATION AND DUAL-REPO VERIFICATIONS PASSED (7/7)!');
    console.log('===========================================================');
    process.exit(0);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (stderr) process.stderr.write(stderr);
  }
}

run().catch(err => {
  console.error('\nFAIL Integration verification:', err);
  process.exitCode = 1;
});
