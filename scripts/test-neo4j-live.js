const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');

// 1 & 2. Load .env.local using absolute path based on __dirname
const envLocal = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
}

// 3. Verify detection without printing secrets
const uri = process.env.NEO4J_URI || '';
const username = process.env.NEO4J_USERNAME || '';
const password = process.env.NEO4J_PASSWORD || '';

console.log('--- Neo4j Environment Detection ---');
console.log('NEO4J_URI detected:', Boolean(uri), `(protocol: ${uri.split('://')[0]}, length: ${uri.length})`);
console.log('NEO4J_USERNAME detected:', Boolean(username), `(value: ${username})`);
console.log('NEO4J_PASSWORD detected:', Boolean(password), `(length: ${password.length}, masked: ${'*'.repeat(password.length)})`);

if (!uri || !username || !password) {
  console.error('ERROR: Missing required Neo4j credentials in .env.local');
  process.exit(1);
}

const { isConfigured, checkNeo4j, persistGraph, readGraph, closeNeo4j } = require('../lib/neo4j');
const { getDemoGraph } = require('../lib/demo');

async function testNeo4j() {
  console.log('\n--- Step 4 & 5: Initialize Official Driver & Verify Connectivity ---');
  let neo4jModule;
  try {
    neo4jModule = await import('neo4j-driver');
  } catch (err) {
    console.error('Failed to import neo4j-driver:', err.message);
    process.exit(1);
  }
  const neo4j = neo4jModule.default || neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 10000
  });

  try {
    const serverInfo = await driver.verifyConnectivity();
    console.log('SUCCESS: driver.verifyConnectivity() passed!');
    if (serverInfo && serverInfo.address) console.log('Server info:', serverInfo.address, serverInfo.version || '');

    console.log('\n--- Step 6: Execute RETURN 1 AS result ---');
    const session = driver.session();
    try {
      const result = await session.run('RETURN 1 AS result');
      const val = result.records[0]?.get('result');
      console.log('Query result:', Number(val));
      if (Number(val) !== 1) throw new Error(`Expected 1, got ${val}`);
      console.log('SUCCESS: Query RETURN 1 AS result executed successfully.');
    } finally {
      await session.close();
    }

    console.log('\n--- Step 7: Create Test Node and Relationship, Read Back, and Cleanup ---');
    const testSession = driver.session();
    const testTag = `test_${Date.now()}`;
    try {
      // Create temporary nodes and relationship
      await testSession.run(`
        CREATE (a:WhyTraceTestNode {tag: $tag, name: 'Node A'})
        CREATE (b:WhyTraceTestNode {tag: $tag, name: 'Node B'})
        CREATE (a)-[r:WHYTRACE_TEST_REL {tag: $tag, label: 'connects_to'}]->(b)
      `, { tag: testTag });
      console.log('Created temporary test nodes and relationship.');

      // Read them back
      const readResult = await testSession.run(`
        MATCH (a:WhyTraceTestNode {tag: $tag})-[r:WHYTRACE_TEST_REL {tag: $tag}]->(b:WhyTraceTestNode {tag: $tag})
        RETURN a.name AS aName, type(r) AS relType, b.name AS bName
      `, { tag: testTag });

      const record = readResult.records[0];
      if (!record) throw new Error('Failed to read back temporary test node and relationship.');
      console.log('Read back verification:', {
        from: record.get('aName'),
        rel: record.get('relType'),
        to: record.get('bName')
      });
      console.log('SUCCESS: Temporary node and relationship read back verified.');

      // Clean up
      const deleteResult = await testSession.run(`
        MATCH (n:WhyTraceTestNode {tag: $tag})
        DETACH DELETE n
      `, { tag: testTag });
      console.log('SUCCESS: Cleaned up temporary test nodes and relationships.');
    } finally {
      await testSession.close();
    }

    console.log('\n--- Step 8: Test Actual Repository Graph Persistence ---');
    const demo = getDemoGraph();
    // Use a scoped test repo to avoid overwriting production snapshots
    const testGraph = {
      ...demo,
      repository: {
        ...demo.repository,
        fullName: 'test/neo4j-verification'
      }
    };

    console.log(`Persisting repository graph "${testGraph.repository.fullName}" with ${testGraph.nodes.length} nodes and ${testGraph.edges.length} edges...`);
    const persistResult = await persistGraph(testGraph);
    console.log('Persist result:', persistResult);

    console.log('Reading back persisted repository graph...');
    const readGraphResult = await readGraph('test/neo4j-verification');
    console.log(`Read back graph: ${readGraphResult.nodes.length} nodes, ${readGraphResult.edges.length} relationships, ${readGraphResult.evidence.length} evidence records.`);

    if (readGraphResult.nodes.length < testGraph.nodes.length || readGraphResult.edges.length < testGraph.edges.length) {
      throw new Error(`Mismatch in persisted repository graph! Expected >= ${testGraph.nodes.length} nodes, got ${readGraphResult.nodes.length}`);
    }
    console.log('SUCCESS: Repository graph persistence and read-back fully verified!');

    // Cleanup test repository
    const cleanupSession = driver.session();
    try {
      await cleanupSession.run('MATCH (a:Artifact {repoId: $repoId}) DETACH DELETE a', {
        repoId: 'repository:test/neo4j-verification'
      });
      console.log('SUCCESS: Cleaned up test repository snapshot.');
    } finally {
      await cleanupSession.close();
    }

    console.log('\n--- Step 9: Verify checkNeo4j() Integration Health Helper ---');
    const health = await checkNeo4j();
    console.log('checkNeo4j() output:', health);
    if (!health.connected) throw new Error(`checkNeo4j() reported connected: false: ${health.message}`);

    console.log('\nALL NEO4J CHECKS PASSED WITH REAL AURADB INSTANCE!');
  } finally {
    await driver.close();
    await closeNeo4j();
  }
}

testNeo4j().catch(err => {
  console.error('\nNEO4J ERROR:', err);
  process.exit(1);
});
