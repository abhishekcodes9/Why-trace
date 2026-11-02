function getDemoGraph() {
  const nodes = [
    { id: 'repository:acme/checkout-service', kind: 'repository', label: 'acme/checkout-service', subtitle: 'Synthetic repository fixture', demo: true },
    { id: 'file-retry', kind: 'file', label: 'retry.ts', subtitle: '/packages/checkout/src/lib/retry.ts', demo: true, preview: 'export const DEFAULT_RETRY_LIMIT = 3;\n\nexport function createRetryHandler(options = {}) {\n  const limit = options.limit ?? DEFAULT_RETRY_LIMIT;\n  // bounded retry policy\n}' },
    { id: 'file-api', kind: 'file', label: 'api-handler.ts', subtitle: '/packages/checkout/src/server/api-handler.ts', demo: true, preview: 'import { createRetryHandler } from "../lib/retry";\n\nexport async function handleApiRequest(req, res) {\n  const handler = createRetryHandler();\n  return handler.execute(req);\n}' },
    { id: 'file-config', kind: 'file', label: 'config.ts', subtitle: '/packages/checkout/src/config/config.ts', demo: true, preview: 'export const config = {\n  retries: {\n    max: 3,\n    backoffMs: 200\n  }\n};' },
    { id: 'pr-58671', kind: 'pull_request', label: 'PR #58671', subtitle: 'Add retry handling for transient API failures', date: '2026-07-18', author: 'leerobinson', demo: true },
    { id: 'issue-58362', kind: 'issue', label: 'Issue #58362', subtitle: 'Intermittent upstream timeouts', date: '2026-07-10', author: 'sophiebits', demo: true },
    { id: 'decision-retry', kind: 'decision', label: 'Retry limit = 3', subtitle: 'Decision documented in PR review', date: '2026-07-18', author: 'leerobinson', confidence: 0.91, demo: true },
    { id: 'commit-2f9e3a1', kind: 'commit', label: '2f9e3a1', subtitle: 'Implement bounded retry logic', date: '2026-07-18', author: 'leerobinson', demo: true },
    { id: 'developer-leo', kind: 'developer', label: 'leerobinson', subtitle: 'Author · 3 commits · 2 PRs', demo: true, role: 'Author' },
    { id: 'developer-sophie', kind: 'developer', label: 'sophiebits', subtitle: 'Reviewer · 1 PR · 3 comments', demo: true, role: 'Reviewer' },
    { id: 'config-retry', kind: 'configuration', label: 'retryPolicy', subtitle: 'checkout-service configuration', demo: true },
    { id: 'discussion-pr', kind: 'discussion', label: 'PR review discussion', subtitle: 'Transient failures vs. repeated work', date: '2026-07-18', author: 'sophiebits', demo: true }
  ];
  const edges = [
    { id: 'e1', from: 'pr-58671', to: 'file-retry', kind: 'MODIFIES', label: 'modifies' },
    { id: 'e2', from: 'issue-58362', to: 'pr-58671', kind: 'REFERENCES', label: 'motivated' },
    { id: 'e3', from: 'pr-58671', to: 'decision-retry', kind: 'SUPPORTS', label: 'documents' },
    { id: 'e4', from: 'commit-2f9e3a1', to: 'file-retry', kind: 'MODIFIES', label: 'changes' },
    { id: 'e5', from: 'developer-leo', to: 'commit-2f9e3a1', kind: 'AUTHORED', label: 'authored' },
    { id: 'e6', from: 'decision-retry', to: 'config-retry', kind: 'RELATED_TO', label: 'sets' },
    { id: 'e7', from: 'discussion-pr', to: 'decision-retry', kind: 'SUPPORTS', label: 'explains' },
    { id: 'e8', from: 'issue-58362', to: 'discussion-pr', kind: 'RELATED_TO', label: 'discussed in' },
    { id: 'e9', from: 'developer-sophie', to: 'discussion-pr', kind: 'AUTHORED', label: 'reviewed' },
    { id: 'e10', from: 'commit-2f9e3a1', to: 'config-retry', kind: 'RELATED_TO', label: 'configures' },
    { id: 'e11', from: 'file-api', to: 'file-retry', kind: 'REFERENCES', label: 'imports' }
  ];
  const evidence = [
    { id: 'pr-58671', kind: 'pull_request', title: 'PR #58671 — Add bounded retry handling', body: 'SYNTHETIC DEMO RECORD: This pull request introduces the DEFAULT_RETRY_LIMIT configuration and retry behavior. It records a maximum of three attempts for transient upstream failures and links the change to issue #58362.', date: '2026-07-18', author: 'leerobinson', tags: ['retry', 'three', 'transient', 'attempts', 'decision', 'configuration', 'introduce', 'behavior', 'default_retry_limit', '58671'] },
    { id: 'issue-58362', kind: 'issue', title: 'Issue #58362 — Intermittent upstream timeouts', body: 'SYNTHETIC DEMO RECORD: Reports intermittent upstream timeouts and asks for bounded retry handling without causing repeated work.', date: '2026-07-10', author: 'sophiebits', tags: ['retry', 'timeout', 'transient', 'upstream', '58362'] },
    { id: 'commit-2f9e3a1', kind: 'commit', title: 'Commit 2f9e3a1 — Implement bounded retry logic', body: 'SYNTHETIC DEMO RECORD: Introduces DEFAULT_RETRY_LIMIT = 3 in retry.ts and uses the value as the default when no override is supplied.', date: '2026-07-18', author: 'leerobinson', tags: ['retry', 'three', 'limit', 'configuration', '2f9e3a1'] },
    { id: 'discussion-pr', kind: 'discussion', title: 'PR review — Retry strategy trade-off', body: 'SYNTHETIC DEMO RECORD: Reviewer discussion states that three attempts were selected as a bounded compromise between recovering from transient errors and avoiding excessive repeated requests.', date: '2026-07-18', author: 'sophiebits', tags: ['three', 'attempts', 'trade-off', 'transient', 'discussion'] },
    { id: 'decision-retry', kind: 'decision', title: 'Decision — Retry limit = 3', body: 'SYNTHETIC DEMO RECORD: The decision is supported by the PR review discussion, the pull request record, and the implementation commit.', date: '2026-07-18', author: 'leerobinson', tags: ['retry', 'three', 'decision'] },
    { id: 'file-retry', kind: 'file', title: 'File — retry.ts', body: 'SYNTHETIC DEMO DATA: retry.ts declares DEFAULT_RETRY_LIMIT = 3 and uses it as the default when a retry override is not supplied.', date: '2026-07-18', author: 'leerobinson', tags: ['retry', 'limit', 'three', 'configuration', 'default_retry_limit'] },
    { id: 'config-retry', kind: 'configuration', title: 'Configuration — retryPolicy', body: 'SYNTHETIC DEMO DATA: retryPolicy exposes the bounded retry default used by the checkout service.', date: '2026-07-18', author: 'leerobinson', tags: ['retry', 'configuration', 'policy', 'three'] }
  ];
  return {
    repository: { fullName: 'acme/checkout-service', description: 'Synthetic repository fixture for demonstrating evidence-linked engineering investigations.', url: null, defaultBranch: 'main', stars: null, updatedAt: '2026-07-18T11:30:00.000Z', isDemo: true },
    nodes, edges, evidence,
    stats: { commits: 1, pullRequests: 1, issues: 1, files: 3, nodes: nodes.length, relationships: edges.length },
    storageMode: 'demo_fixture', ingestedAt: new Date().toISOString()
  };
}
module.exports = { getDemoGraph };
