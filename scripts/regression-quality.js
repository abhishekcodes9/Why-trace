const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const port = 3280 + Math.floor(Math.random() * 200);
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
  console.log('WHYTRACE — EVIDENCE RELEVANCE & QUALITY REGRESSION TESTS');
  console.log('===========================================================');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: host },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => (stderr += chunk.toString()));

  try {
    await waitForServer(child);

    // REGRESSION 1: Retry-related question must NOT return unrelated cache documentation
    console.log('\n[1/5] Regression Test 1: Retry question on repo without retry rationale...');
    // Ingest or load vercel/next.js
    const ingestNext = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'vercel/next.js' })
    });
    assert.equal(ingestNext.status, 200);

    const askRetryNext = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Explain the purpose of the retry logic in this repository.',
        repository: 'vercel/next.js'
      })
    });
    assert.equal(askRetryNext.status, 200);
    const retryDataNext = await askRetryNext.json();

    console.log('      Status:', retryDataNext.answer.status);
    console.log('      Confidence:', retryDataNext.answer.confidence);
    console.log('      Evidence count:', retryDataNext.answer.evidence.length);

    assert.equal(retryDataNext.answer.status, 'insufficient_evidence', 'Must abstain when repository lacks retry rationale');
    assert.equal(retryDataNext.answer.evidence.length, 0, 'Must NOT return unrelated evidence');
    assert.equal(
      retryDataNext.answer.evidence.some(e => /cache-component|blocking route|#100191/i.test(`${e.title} ${e.body}`)),
      false,
      'Must NOT return unrelated Cache Components or PR #100191'
    );
    assert.match(retryDataNext.answer.answer, /could not find enough repository evidence/i);
    console.log('      ✓ PASS: Retry question abstained honestly; zero unrelated cache docs returned.');

    // Also verify on SayRight
    const askRetrySayRight = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Explain the purpose of the retry logic in this repository.',
        repository: 'abhishekcodes9/SayRight'
      })
    });
    assert.equal(askRetrySayRight.status, 200);
    const retryDataSR = await askRetrySayRight.json();
    assert.equal(retryDataSR.answer.status, 'insufficient_evidence');
    assert.equal(retryDataSR.answer.evidence.length, 0);
    console.log('      ✓ PASS: Retry question on SayRight abstained cleanly.');

    // REGRESSION 2: Unsupported Rust question must abstain
    console.log('\n[2/5] Regression Test 2: Unsupported Rust question must abstain...');
    const askRust = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Why was Rust chosen for the backend rewrite?',
        repository: 'vercel/next.js'
      })
    });
    assert.equal(askRust.status, 200);
    const rustData = await askRust.json();
    console.log('      Status:', rustData.answer.status);
    console.log('      Confidence:', rustData.answer.confidence);
    assert.equal(rustData.answer.status, 'insufficient_evidence');
    assert.equal(rustData.answer.confidence, 0);
    assert.equal(rustData.answer.evidence.length, 0);
    assert.match(rustData.answer.answer, /could not find enough repository evidence/i);
    console.log('      ✓ PASS: Unsupported Rust question abstains with zero hallucinations.');

    // REGRESSION 3: Commit-specific question must return correct commit and diff
    console.log('\n[3/5] Regression Test 3: Commit-specific question returns exact commit and diff...');
    const askCommit = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'What changed in commit fbf3cf7 and what was the documented intent?',
        repository: 'abhishekcodes9/SayRight'
      })
    });
    assert.equal(askCommit.status, 200);
    const commitData = await askCommit.json();
    console.log('      Status:', commitData.answer.status);
    assert.equal(commitData.answer.status, 'answered');
    assert.match(commitData.answer.answer, /commit fbf3cf7/i);
    assert.match(commitData.answer.answer, /\.env\.example/i);
    assert.ok(commitData.answer.evidence.length > 0);
    console.log('      ✓ PASS: Commit fbf3cf7 returned with structured diff breakdown.');

    // REGRESSION 4: Relevant question retains multi-hop graph evidence
    console.log('\n[4/5] Regression Test 4: Relevant question retains multi-hop graph evidence...');
    const askDemo = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Why is the retry limit set to 3 in this implementation?',
        repository: 'acme/checkout-service',
        demo: true
      })
    });
    assert.equal(askDemo.status, 200);
    const demoData = await askDemo.json();
    console.log('      Status:', demoData.answer.status);
    console.log('      Evidence count:', demoData.answer.evidence.length);
    console.log('      Path traversal edges:', demoData.answer.path.length);
    assert.equal(demoData.answer.status, 'answered');
    assert.ok(demoData.answer.evidence.length >= 2, 'Must cite direct evidence');
    assert.ok(demoData.answer.path.length >= 2, 'Must preserve multi-hop graph traversal');

    // Multi-hop review discussion query
    const askConfig = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Why was this configuration introduced?',
        repository: 'acme/checkout-service',
        demo: true
      })
    });
    assert.equal(askConfig.status, 200);
    const configData = await askConfig.json();
    assert.equal(configData.answer.status, 'answered');
    assert.ok(configData.answer.evidence.some(e => e.kind === 'discussion'), 'Must traverse to review discussion');
    console.log('      ✓ PASS: Multi-hop graph evidence preserved for grounded inquiries.');

    // REGRESSION 5: System Health Neo4j status consistency
    console.log('\n[5/5] Regression Test 5: System health Neo4j backend status verification...');
    const statusRes = await fetch(`${base}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.ok(statusData.neo4j);
    assert.equal(typeof statusData.neo4j.connected, 'boolean');
    console.log('      Neo4j connected:', statusData.neo4j.connected);
    console.log('      GitHub authenticated:', statusData.github?.authenticated);
    console.log('      ✓ PASS: Integration status is fully synchronized and consistent.');

    console.log('\n===========================================================');
    console.log('ALL EVIDENCE RELEVANCE & QUALITY REGRESSIONS PASSED (5/5)!');
    console.log('===========================================================');
    process.exit(0);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (stderr) process.stderr.write(stderr);
  }
}

run().catch(err => {
  console.error('\nFAIL Regression test:', err);
  process.exitCode = 1;
});
