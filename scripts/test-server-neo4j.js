const { spawn } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');

const port = 3981;
const host = '127.0.0.1';
const base = `http://${host}:${port}`;

async function run() {
  console.log('Testing server.js with loaded .env.local on port', port);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: host },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', d => stderr += d.toString());

  try {
    // Wait for server to start
    let up = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(base);
        if (res.ok) { up = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    if (!up) throw new Error('Server did not start.');

    // Check /api/status
    console.log('Fetching /api/status...');
    const statusRes = await fetch(`${base}/api/status`);
    const statusData = await statusRes.json();
    console.log('Neo4j status:', statusData.neo4j);

    // Check /api/health/neo4j
    console.log('Fetching /api/health/neo4j...');
    const healthRes = await fetch(`${base}/api/health/neo4j`);
    const healthData = await healthRes.json();
    console.log('Neo4j health endpoint response:', healthRes.status, healthData);

    if (!statusData.neo4j.connected) {
      throw new Error(`Neo4j is not reported connected: ${JSON.stringify(statusData.neo4j)}`);
    }

    console.log('\nSUCCESS: server.js correctly loaded .env.local and verified Neo4j connection!');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 1000))]);
    if (stderr) console.error(stderr);
  }
}

run().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
