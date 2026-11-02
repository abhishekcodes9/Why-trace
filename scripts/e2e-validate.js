const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const port = 3892;
const host = '127.0.0.1';
const base = `http://${host}:${port}`;

async function waitForServer(child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}.`);
    try {
      const res = await fetch(base);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Server did not start within 15 seconds.');
}

async function run() {
  console.log('--- Starting WhyTrace End-to-End Validation ---');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: host },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', d => stderr += d.toString());

  try {
    await waitForServer(child);

    // 1. Static asset verification
    console.log('[1/7] Testing static assets and HTML markup...');
    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('WhyTrace'), 'HTML contains WhyTrace brand');
    assert.ok(html.includes('Knowledge Graph'), 'HTML contains Knowledge Graph panel');
    assert.ok(html.includes('id="graph-svg"'), 'HTML contains SVG graph');
    assert.ok(html.includes('id="zoom-in"'), 'HTML contains zoom-in tool button');
    assert.ok(html.includes('id="zoom-out"'), 'HTML contains zoom-out tool button');
    assert.ok(html.includes('id="fit-graph"'), 'HTML contains fit/reset button');
    assert.ok(html.includes('data-tab="overview"'), 'HTML contains Overview tab');
    assert.ok(html.includes('data-tab="changes"'), 'HTML contains Changes tab');
    assert.ok(html.includes('data-tab="references"'), 'HTML contains References tab');
    assert.ok(html.includes('id="answer-supersession"'), 'HTML contains supersession banner element');
    assert.ok(html.includes('id="evidence-view"'), 'HTML contains Evidence inspector view');

    const cssRes = await fetch(`${base}/styles.css`);
    assert.equal(cssRes.status, 200);
    const css = await cssRes.text();
    assert.ok(css.includes('overflow-x: hidden'), 'CSS includes overflow-x: hidden to prevent horizontal scrollbars');
    assert.ok(css.includes('@media (max-width: 1400px)'), 'CSS includes responsive adjustments for 1366px screens');

    const jsRes = await fetch(`${base}/app.js`);
    assert.equal(jsRes.status, 200);
    const js = await jsRes.text();
    assert.ok(js.includes('calculateLayout'), 'app.js includes layout engine');
    assert.ok(js.includes('zoomBy'), 'app.js includes zoom controls');

    // 2. Demo Ingestion
    console.log('[2/7] Testing Demo ingestion...');
    const ingestRes = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo: true })
    });
    assert.equal(ingestRes.status, 200);
    const ingestData = await ingestRes.json();
    assert.equal(ingestData.ok, true);
    assert.equal(ingestData.graph.repository.isDemo, true);
    assert.ok(ingestData.graph.nodes.length >= 10, 'Demo graph contains enriched nodes');
    assert.ok(ingestData.graph.edges.length >= 10, 'Demo graph contains enriched relationships');

    // Verify related developers and files are present in the fixture
    const devNodes = ingestData.graph.nodes.filter(n => n.kind === 'developer');
    assert.ok(devNodes.some(n => n.label === 'leerobinson'), 'Developer leerobinson present');
    assert.ok(devNodes.some(n => n.label === 'sophiebits'), 'Developer sophiebits present');

    const fileNodes = ingestData.graph.nodes.filter(n => n.kind === 'file');
    assert.ok(fileNodes.some(n => n.label === 'retry.ts'), 'File retry.ts present');
    assert.ok(fileNodes.some(n => n.label === 'api-handler.ts'), 'File api-handler.ts present');
    assert.ok(fileNodes.some(n => n.label === 'config.ts'), 'File config.ts present');

    // 3. Demo Question Investigation
    console.log('[3/7] Testing Investigation question: "Why is the retry limit set to 3 in this implementation?"...');
    const askRes = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Why is the retry limit set to 3 in this implementation?',
        repository: 'acme/checkout-service',
        demo: true
      })
    });
    assert.equal(askRes.status, 200);
    const askData = await askRes.json();
    assert.equal(askData.ok, true);
    assert.equal(askData.answer.status, 'answered');
    assert.ok(askData.answer.evidence.length >= 4, 'Includes Key Evidence records');
    assert.ok(askData.answer.path.length > 0, 'Includes graph traversal path');
    assert.equal(askData.answer.supersession.active, true, 'Supersession status marked active for demo');
    assert.ok(askData.answer.supersession.label.includes('active'), 'Includes active supersession label');
    assert.ok(/3|three/i.test(askData.answer.answer), 'Answer cites 3 or three retries');
    assert.ok(askData.answer.evidence.some(e => e.id === 'pr-58671'), 'Evidence cites PR #58671');
    assert.ok(askData.answer.evidence.some(e => e.id === 'issue-58362'), 'Evidence cites issue #58362');

    // 4. Honest Abstention on Unsupported Question
    console.log('[4/7] Testing Honest Abstention on unsupported question...');
    const abstentionRes = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Why was PostgreSQL replaced with Apache Cassandra?',
        repository: 'acme/checkout-service',
        demo: true
      })
    });
    assert.equal(abstentionRes.status, 200);
    const abstentionData = await abstentionRes.json();
    assert.equal(abstentionData.answer.status, 'insufficient_evidence');
    assert.equal(abstentionData.answer.evidence.length, 0);
    assert.ok(abstentionData.answer.answer.includes('could not find repository records'));

    // 5. System Health Status
    console.log('[5/7] Testing Integration System Health endpoint...');
    const statusRes = await fetch(`${base}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    console.log('Detected Neo4j status:', statusData.neo4j.status, 'connected:', statusData.neo4j.connected);
    assert.ok(['connected', 'not_configured'].includes(statusData.neo4j.status));
    assert.ok(['deterministic_only', 'configured_not_verified'].includes(statusData.ai.status));

    // 6. Neo4j Health Endpoint
    console.log('[6/7] Testing Neo4j dedicated health check endpoint...');
    const neoHealth = await fetch(`${base}/api/health/neo4j`);
    assert.equal(neoHealth.status, 200);
    const neoHealthData = await neoHealth.json();
    assert.equal(neoHealthData.connected, statusData.neo4j.connected);

    // 7. Graph Retrieval API
    console.log('[7/7] Testing Graph retrieval API...');
    const graphRes = await fetch(`${base}/api/graph?repository=acme%2Fcheckout-service`);
    assert.equal(graphRes.status, 200);
    const graphData = await graphRes.json();
    assert.equal(graphData.ok, true);
    assert.equal(graphData.graph.repository.isDemo, true);

    console.log('\nAll End-to-End verification checks PASSED successfully!');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 1000))]);
    if (stderr) console.error(stderr);
  }
}

run().catch(err => {
  console.error('FAIL E2E Validation:', err);
  process.exitCode = 1;
});
