# WhyTrace — 2–3 minute demo script

## Before the demo

1. Start the project with `node server.js` (Node.js 20+).
2. Open `http://127.0.0.1:3000` in a browser.
3. No API key or database is required for the synthetic demo.

## Walkthrough

### 1. Explain the problem (15–20 sec)

“Developers can read what code does, but the reason behind a design choice is often spread across commits, pull requests, issues and review discussions. WhyTrace connects that history and makes the evidence inspectable.”

### 2. Open the investigation workspace (20 sec)

Click **Explore synthetic demo**. Point out the visible **DEMO DATA** label. Explain that `acme/checkout-service` is a deliberately synthetic fixture, not a real company repository.

### 3. Inspect the graph (25–30 sec)

Select `retry.ts`. Show its connected pull request, issue, decision, commit, developer, configuration and discussion nodes. Drag the canvas to pan, scroll to zoom, and use the reset control to restore the view.

### 4. Ask the key question (30 sec)

Ask: “Why is the retry limit set to 3 in this implementation?”

Explain that the deterministic retriever identifies relevant evidence records, expands through graph relationships, and returns the reviewer discussion and related PR/issue/commit records. Open the evidence records and point out the synthetic labels.

### 5. Demonstrate honest abstention (15–20 sec)

Ask: “Why was the Kubernetes cluster migrated to SaturnDB?”

WhyTrace should return **Insufficient evidence** rather than invent an answer.

### 6. Explain the Neo4j path (20–30 sec)

Open **System Health**. The default demo is not stored in Neo4j. Explain that configuring AuraDB enables the official driver path; the app only labels a live repository as Neo4j-backed after an actual graph write and read-back succeeds.

### 7. Optional live repository (only if network is available)

Open **Repository**, enter a public GitHub repository such as `vercel/next.js`, and choose **Connect repository**. Be clear about the bounded ingestion scope and whether the resulting graph is `memory_cache` or `neo4j`.

## Claims to avoid

- Do not call the synthetic fixture real repository history.
- Do not claim Neo4j is connected unless System Health confirms it and a real repository snapshot has passed write/read-back.
- Do not call Gemini connected unless an actual request has succeeded.
- Do not call the one-hop lexical retriever a full enterprise GraphRAG platform or claim Aura Agents integration.
- Do not describe heuristic confidence as a calibrated probability.
