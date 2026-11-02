# WhyTrace

**Understand why code exists, not just what it does.**

WhyTrace is an evidence-first engineering intelligence platform. It connects source files, Git commits, pull requests, issues, discussions, and decisions to explain the historical engineering rationale behind code changes and configuration values.

---

## Core Principles

- **Evidence before AI:** Every explanation is grounded in concrete repository records before any language model rephrasing occurs.
- **Graph relationships before keyword matching:** Investigation seeds traverse up to two real graph hops (files, commits, PRs, issues, authors).
- **Never invent engineering history:** Code observations are strictly separated from documented intent. When repository evidence does not document why a decision was made, WhyTrace honestly abstains.
- **Real Neo4j persistence:** Durable AuraDB storage with parameterized Cypher queries, graph write/read-back verification, and offline retrieval after server restarts.
- **Truthful storage modes:** Clear indicators for `neo4j` (persisted), `memory_cache` (process-local), or `demo_fixture` (synthetic).

---

## Architecture

```
User Query (e.g. "what exactly changed in commit fbf3cf7")
   │
   ▼
[1] Investigation Engine (lib/investigate.js)
   ├── Entity Identification (Full SHA, short SHA, file paths, issue #, PR #)
   ├── Cypher Seed Search (lib/neo4j.js -> findEvidenceSeeds)
   └── Graph Traversal (up to 2 relationship hops across persisted nodes & edges)
   │
   ▼
[2] Grounded Evidence Synthesis (lib/investigate.js)
   ├── Technical Effects (diffs, additions/deletions, file roles)
   ├── Documented Intent (strictly from commit msg / PR rationale)
   └── Citation & Confidence Labeling ("Strong documented evidence", etc.)
   │
   ▼
[3] Optional Server-side Gemini Layer (lib/gemini.js)
   ├── Validates citations against actual retrieved evidence IDs
   └── Preserves groundedDraft fallback if provider unavailable or citations fail
   │
   ▼
[4] UI Presentation (public/app.js, public/index.html, public/styles.css)
   ├── 3-Step Above-the-Fold Investigation Flow
   ├── Interactive D3/SVG Knowledge Graph with Collision Relaxation
   └── Collapsible 8-Item Sidebar & Guided Onboarding Tour
```

---

## Quick Start

Requirements: **Node.js 20 or newer**.

### 1. Installation

```bash
git clone <repository-url>
cd WhyTrace-Delivery
npm install
```

### 2. Environment Variables (.env.local)

Create or configure `.env.local` in the project root:

```env
# Neo4j AuraDB (official driver)
NEO4J_URI=neo4j+s://<your-instance-id>.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<your-password>

# Optional Gemini model synthesis (server-side only)
GEMINI_API_KEY=<your-gemini-api-key>
GEMINI_MODEL=gemini-3.5-flash-lite

# Optional GitHub Personal Access Token (for higher rate limits)
GITHUB_TOKEN=
```

> **Security Note:** `.env.local` is listed in `.gitignore` and must never be committed to version control. Credentials are kept strictly server-side and never exposed to the client.

### 3. Running the Server

```bash
npm start
```
Or run the Windows batch launcher:
```powershell
.\start-whytrace.bat
```

Open your browser to: **`http://127.0.0.1:3000`**

---

## Testing & Verification

WhyTrace includes a comprehensive automated test suite covering smoke tests, end-to-end flows, and all 18 hackathon acceptance scenarios:

```bash
npm test
```

To run individual suites:
```bash
# Run 18 Final Acceptance Scenarios (Neo4j reload, commit diffs, honest abstention, UI checks)
npm run test:acceptance

# Run Smoke Tests only
node scripts/smoke-test.js

# Run E2E Integration Tests only
node scripts/e2e-validate.js
```

---

## Verified Integrations

### 1. Neo4j AuraDB Persistence
- Connected via official `neo4j-driver` using `neo4j+s://` protocol.
- Graph entities stored as parameterized `(:Artifact)` nodes and `[:RELATED]` edges.
- Tested and verified on repository **`abhishekcodes9/SayRight`**:
  - **56 persisted nodes** (repositories, files, commits, PRs, issues, developers, lexical items).
  - **82 persisted relationships** (`HAS_COMMIT`, `MODIFIES`, `AUTHORED`, `REFERENCES`, etc.).
  - Reads directly from Neo4j upon server restart without requiring prior in-memory cache or active GitHub API calls.

### 2. Genuine Commit Investigation (`fbf3cf7`)
- Full SHA (`fbf3cf754d0d90c392ab69377c434ccdd674262a`), short SHA, author, date, and source link.
- File-level breakdown with line modifications (+additions / -deletions).
- Code diff/patch analysis explaining technical effects (e.g. `.env.example` template keys, exclusion patterns).
- Separates technical observations from documented intent; refuses to invent missing PR connections when a commit was pushed directly to the default branch.

### 3. Server-side Gemini Synthesis
- Powered by `gemini-3.5-flash-lite`.
- Strictly constrained to retrieved evidence IDs; rejects ungrounded hallucinated claims.
- Gracefully falls back to deterministic graph grounding if the model is unreachable or citations fail validation.

---

## 5-Minute Judge Demonstration Script

1. **Overview & Landing (0:00 - 0:45)**
   - Open `http://127.0.0.1:3000`.
   - Show the clean developer aesthetic, collapsible 8-item navigation sidebar, and click **"Guided Tour"** for the first-time user introduction.
   - Point out the truthful storage badge and System Health indicator.

2. **Step 1 & 2: Quick Repository Selection & Suggestion (0:45 - 1:30)**
   - Click the **"SayRight (Neo4j)"** quick switcher button above the question box.
   - Show that the repository loads instantly from **Neo4j AuraDB** with 56 nodes and 82 edges.
   - Click one of the suggested question buttons: *"Which commit changed this behavior?"* or enter custom questions.

3. **Step 3: Genuine Commit Investigation (1:30 - 2:45)**
   - Ask: `"What exactly changed in commit fbf3cf7?"`
   - Click **Investigate**.
   - Show the detailed commit report:
     - Full SHA & GitHub commit URL.
     - Changed files (`.env.example`) with exact additions/deletions.
     - Technical effect: template environment keys preventing live secret leakage.
     - Documented intent strictly from repository records.
     - Honest verification: correctly notes that no pull request was associated with this commit in git history.

4. **Knowledge Graph Exploration (2:45 - 3:45)**
   - Scroll down to the interactive **Knowledge Graph**.
   - Select node `.env.example`.
   - Observe collision-free force relaxation, zoom/pan controls, and active path highlighting showing connected commits and repository nodes.
   - Click **"Investigate Connected Evidence"** directly from the inspector panel.

5. **Honest Abstention & Architecture Review (3:45 - 5:00)**
   - Submit an unsupported question: *"Why was the backend rewritten in Rust?"*
   - Observe WhyTrace's honest abstention: *"I could not find enough repository evidence to explain why this decision was made... WhyTrace will not invent a rationale."*
   - Navigate to **System Health** in the sidebar to verify live Neo4j AuraDB connectivity (`CONNECTED`), storage mode (`neo4j`), and server diagnostic metrics.

---

## Known Limitations

- **Bounded Ingestion Scope:** Initial GitHub ingestion bounds commits, PRs, and comments to prevent hitting unauthenticated GitHub API rate limits.
- **Textual Decision Extraction:** Engineering decisions are extracted using explicit textual patterns and PR discussions rather than a full semantic AST parse.
- **Rate Limits:** Unauthenticated GitHub API requests are capped at 60/hr by GitHub. Supplying a `GITHUB_TOKEN` in `.env.local` removes this restriction.
