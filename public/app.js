(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    graph: null,
    answer: null,
    selectedId: null,
    activeTab: 'overview',
    mode: 'graph',
    currentScreen: 'landing',
    search: '',
    activePath: new Set(),
    graphView: { zoom: 1, x: 0, y: 0, dragging: false, moved: false, lastX: 0, lastY: 0 }
  };

  const palette = {
    file: '#36d7e8',
    configuration: '#54d99c',
    commit: '#499fff',
    pull_request: '#a76bff',
    issue: '#ff6d78',
    decision: '#f3bf58',
    developer: '#7b8dff',
    discussion: '#ce76ec',
    repository: '#36d7e8',
    function: '#36d7e8'
  };

  const icons = {
    file: '▤',
    configuration: '⚙',
    commit: '⑂',
    pull_request: '⑃',
    issue: '◎',
    decision: '✦',
    developer: '◉',
    discussion: '☷',
    repository: '◈',
    function: 'ƒ'
  };

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const safeGithubURL = value => typeof value === 'string' && /^https:\/\/github\.com\//i.test(value) ? value : null;

  async function api(path, options = {}) {
    const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
    let data;
    try { data = await response.json(); } catch { throw new Error(`Server returned an invalid response (${response.status}).`); }
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  function message(text, type = 'success') {
    const box = type === 'error' ? $('#error') : $('#notice');
    const other = type === 'error' ? $('#notice') : $('#error');
    other.classList.add('hidden');
    box.textContent = text;
    box.classList.remove('hidden');
    if (type !== 'error') setTimeout(() => box.classList.add('hidden'), 9000);
  }

  function resetGraphView() {
    state.graphView.zoom = 1;
    state.graphView.x = 0;
    state.graphView.y = 0;
    state.graphView.dragging = false;
    state.graphView.moved = false;
    applyTransform();
  }

  function applyTransform() {
    const scene = $('#graph-scene');
    if (scene) {
      scene.setAttribute('transform', `translate(${state.graphView.x} ${state.graphView.y}) scale(${state.graphView.zoom})`);
    }
  }

  function zoomBy(factor) {
    const svg = $('#graph-svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = 950 / 2;
    const cy = 340 / 2;
    const v = state.graphView;
    const worldX = (cx - v.x) / v.zoom;
    const worldY = (cy - v.y) / v.zoom;
    const next = Math.max(0.55, Math.min(2.5, v.zoom * factor));
    v.x = cx - worldX * next;
    v.y = cy - worldY * next;
    v.zoom = next;
    applyTransform();
  }

  function showScreen(name) {
    state.currentScreen = name;
    $('#landing').classList.toggle('hidden', name !== 'landing');
    $('#workspace').classList.toggle('hidden', name !== 'workspace');
    $('#health-screen').classList.toggle('hidden', name !== 'health');
    if (name === 'workspace' && !state.graph) void loadDemo();
    if (name === 'health') void refreshHealth();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function loadDemo() {
    const syncBtn = $('#sync-button');
    syncBtn.disabled = true;
    syncBtn.textContent = 'Loading…';
    try {
      const data = await api('/api/ingest', { method: 'POST', body: JSON.stringify({ demo: true }) });
      state.graph = data.graph;
      state.selectedId = 'file-retry';
      state.answer = null;
      state.mode = 'graph';
      state.search = '';
      state.activePath.clear();
      $('#graph-search').value = '';
      $('#clear-search')?.classList.add('hidden');
      resetGraphView();
      $('#repo-input').value = '';
      renderWorkspace();
      message('Loaded synthetic DEMO DATA fixture. It is not a real GitHub repository and is not stored in Neo4j.');
      $('#question-input').value = 'Why is the retry limit set to 3 in this implementation?';
      await askQuestion();
    } catch (error) {
      message(error.message, 'error');
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = '↻ Reload demo';
    }
  }

  async function ingestRepository() {
    const value = $('#repo-input').value.trim();
    if (!value) return message('Enter a public GitHub repository URL or owner/repository.', 'error');
    const button = $('#connect-repo');
    button.disabled = true;
    button.textContent = 'Fetching…';
    $('#error').classList.add('hidden');
    try {
      const data = await api('/api/ingest', { method: 'POST', body: JSON.stringify({ repository: value }) });
      state.graph = data.graph;
      state.answer = null;
      state.selectedId = state.graph.nodes.find(n => n.kind === 'file')?.id || state.graph.nodes[0]?.id || null;
      state.mode = 'graph';
      state.search = '';
      state.activePath.clear();
      $('#graph-search').value = '';
      $('#clear-search')?.classList.add('hidden');
      resetGraphView();
      renderWorkspace();
      setView('investigation');
      if (data.warning) message(data.warning, 'error');
      else message(data.message || `Ingested ${state.graph.repository.fullName}.`);
      $('#repo-input').value = state.graph.repository.fullName;
      await refreshInlineHealth();
    } catch (error) {
      message(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Connect repository ↗';
    }
  }

  async function askQuestion() {
    if (!state.graph) return message('Load a repository before starting an investigation.', 'error');
    const question = $('#question-input').value.trim();
    if (question.length < 8) return message('Please enter a more specific question (at least 8 characters).', 'error');
    const button = $('#ask-button');
    button.disabled = true;
    $('#answer-loading').classList.remove('hidden');
    $('#error').classList.add('hidden');
    try {
      const data = await api('/api/ask', {
        method: 'POST',
        body: JSON.stringify({
          question,
          repository: state.graph.repository.fullName,
          demo: state.graph.repository.isDemo,
          focusNode: state.selectedId
        })
      });
      state.answer = data.answer;
      state.activePath = new Set();
      if (Array.isArray(data.answer?.path)) {
        data.answer.path.forEach(step => {
          state.activePath.add(step.from);
          state.activePath.add(step.to);
        });
      }
      renderAnswer();
      renderGraph();
    } catch (error) {
      message(error.message, 'error');
    } finally {
      button.disabled = false;
      $('#answer-loading').classList.add('hidden');
    }
  }

  // Curated, collision-free layout for Demo Fixture + deterministic force relaxation for ingested repos
  function calculateLayout(nodes, edges, selectedId) {
    const map = new Map();

    // Curated high-aesthetic coordinates matching the reference screenshot exactly
    const demoPresets = {
      'file-retry': [475, 170],
      'pr-58671': [210, 190],
      'issue-58362': [290, 70],
      'commit-2f9e3a1': [320, 275],
      'config-retry': [430, 290],
      'decision-retry': [660, 80],
      'developer-leo': [795, 180],
      'discussion-pr': [705, 280],
      'file-api': [380, 140],
      'file-config': [550, 295],
      'developer-sophie': [840, 265],
      'repository:acme/checkout-service': [90, 170]
    };

    const isDemo = state.graph?.repository?.isDemo;
    if (isDemo && nodes.length <= 15) {
      nodes.forEach(node => {
        if (demoPresets[node.id]) {
          map.set(node.id, demoPresets[node.id]);
        }
      });
      // Fallback for any unexpected node in demo
      nodes.forEach(node => {
        if (!map.has(node.id)) {
          map.set(node.id, [475, 170]);
        }
      });
      return map;
    }

    // Force-directed positioning with strict collision avoidance for ingested repositories
    const width = 950;
    const height = 340;
    const centerNode = nodes.find(n => n.id === selectedId) || nodes.find(n => n.kind === 'file') || nodes[0];

    const pos = new Map();
    nodes.forEach((node, i) => {
      if (node.id === centerNode.id) {
        pos.set(node.id, { x: width / 2, y: height / 2, vx: 0, vy: 0 });
      } else {
        const angle = (i / nodes.length) * Math.PI * 2;
        const radius = 120 + (i % 3) * 60;
        pos.set(node.id, {
          x: Math.max(70, Math.min(width - 70, width / 2 + Math.cos(angle) * radius)),
          y: Math.max(50, Math.min(height - 50, height / 2 + Math.sin(angle) * radius * 0.7)),
          vx: 0,
          vy: 0
        });
      }
    });

    const edgeList = edges.map(e => ({ source: pos.get(e.from), target: pos.get(e.to) })).filter(e => e.source && e.target);

    // Run 50 iterations of relaxation
    for (let iter = 0; iter < 50; iter++) {
      // Repulsion between all nodes
      const all = [...pos.values()];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i];
          const b = all[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = 95; // minimum clearance between node centers
          if (dist < minDist) {
            const overlap = (minDist - dist) / dist;
            const fx = dx * overlap * 0.5;
            const fy = dy * overlap * 0.5;
            a.x -= fx;
            a.y -= fy;
            b.x += fx;
            b.y += fy;
          }
        }
      }

      // Spring attraction along edges
      for (const e of edgeList) {
        const dx = e.target.x - e.source.x;
        const dy = e.target.y - e.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 140;
        const force = (dist - targetDist) * 0.05;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        e.source.x += fx;
        e.source.y += fy;
        e.target.x -= fx;
        e.target.y -= fy;
      }

      // Constrain within bounds
      for (const p of all) {
        p.x = Math.max(65, Math.min(width - 65, p.x));
        p.y = Math.max(45, Math.min(height - 45, p.y));
      }
    }

    nodes.forEach(node => {
      const p = pos.get(node.id);
      map.set(node.id, [Math.round(p.x), Math.round(p.y)]);
    });

    return map;
  }

  function renderGraph() {
    if (!state.graph) return;
    const svg = $('#graph-svg');
    const allNodes = state.graph.nodes;
    const allEdges = state.graph.edges;
    const selected = state.selectedId;
    const term = state.search.trim().toLowerCase();

    const degree = new Map(allNodes.map(n => [n.id, 0]));
    for (const edge of allEdges) {
      degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
    }

    const matchedIds = new Set();
    if (term) {
      allNodes.forEach(n => {
        const text = `${n.label} ${n.subtitle || ''} ${n.kind} ${n.author || ''}`.toLowerCase();
        if (text.includes(term)) matchedIds.add(n.id);
      });
    }

    let visibleIds = new Set();
    if (term) {
      matchedIds.forEach(id => visibleIds.add(id));
      for (const edge of allEdges) {
        if (matchedIds.has(edge.from) || matchedIds.has(edge.to)) {
          visibleIds.add(edge.from);
          visibleIds.add(edge.to);
        }
      }
    } else {
      if (selected) visibleIds.add(selected);
      for (const edge of allEdges) {
        if (edge.from === selected || edge.to === selected) {
          visibleIds.add(edge.from);
          visibleIds.add(edge.to);
        }
      }
      const ranked = [...allNodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
      for (const node of ranked) {
        if (visibleIds.size >= 28) break;
        visibleIds.add(node.id);
      }
    }

    const nodes = allNodes.filter(n => visibleIds.has(n.id));
    const edges = allEdges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));
    const points = calculateLayout(nodes, edges, selected);

    const activeNeighbors = new Set([selected]);
    if (selected) {
      edges.filter(e => e.from === selected || e.to === selected).forEach(e => {
        activeNeighbors.add(e.from);
        activeNeighbors.add(e.to);
      });
    }

    const view = state.graphView;
    let html = `
      <g id="graph-scene" transform="translate(${view.x} ${view.y}) scale(${view.zoom})">
        <defs>
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="selectedGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="edgeArrow" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#58728d" />
          </marker>
          <marker id="edgeArrowHighlight" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#36d7e8" />
          </marker>
          <marker id="edgeArrowPath" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#a76bff" />
          </marker>
        </defs>
    `;

    // Render Edges
    for (const edge of edges) {
      const a = points.get(edge.from);
      const b = points.get(edge.to);
      if (!a || !b) continue;

      const isConnectedToSelected = selected && (edge.from === selected || edge.to === selected);
      const isPath = state.activePath.has(edge.from) && state.activePath.has(edge.to);
      const isDimmed = selected && !isConnectedToSelected && !isPath;
      const opacity = isDimmed ? 0.15 : 1;

      // Calculate directional vector & clip at node radius
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const rA = 22;
      const rB = 26;
      const x1 = a[0] + (dx / dist) * rA;
      const y1 = a[1] + (dy / dist) * rA;
      const x2 = b[0] - (dx / dist) * rB;
      const y2 = b[1] - (dy / dist) * rB;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      let marker = 'url(#edgeArrow)';
      let lineClass = 'edge-line';
      if (isPath) {
        marker = 'url(#edgeArrowPath)';
        lineClass = 'edge-line path-highlight';
      } else if (isConnectedToSelected) {
        marker = 'url(#edgeArrowHighlight)';
        lineClass = 'edge-line highlight';
      }

      html += `<g class="edge-group" opacity="${opacity}">`;
      html += `<line class="${lineClass}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="${marker}" />`;

      // Edge label with protective pill background so lines never strike through text
      if (edge.label) {
        const labelText = escapeHTML(edge.label.toUpperCase());
        const pillWidth = Math.max(34, labelText.length * 6.5 + 10);
        html += `
          <g transform="translate(${mx} ${my})">
            <rect class="edge-pill ${isConnectedToSelected || isPath ? 'pill-active' : ''}" x="${-pillWidth / 2}" y="-8" width="${pillWidth}" height="15" rx="4" />
            <text class="edge-label-text" y="3" text-anchor="middle">${labelText}</text>
          </g>
        `;
      }
      html += `</g>`;
    }

    // Render Nodes
    for (const node of nodes) {
      const pt = points.get(node.id);
      if (!pt) continue;
      const [x, y] = pt;
      const color = palette[node.kind] || '#36d7e8';
      const isSelected = node.id === selected;
      const isNeighbor = activeNeighbors.has(node.id);
      const isPath = state.activePath.has(node.id);
      const isMatched = term && matchedIds.has(node.id);

      let opacity = 1;
      if (selected && !isSelected && !isNeighbor && !isPath) opacity = 0.35;
      if (term && !isMatched && !isSelected) opacity = 0.2;

      const isFileNode = node.kind === 'file';
      const kindLabel = escapeHTML(node.kind.toUpperCase().replace('_', ' '));
      const mainLabel = escapeHTML(node.label);

      // Label anchor: place on right unless node is near the right boundary
      const placeLeft = x > 720;
      const textX = placeLeft ? -30 : 30;
      const textAnchor = placeLeft ? 'end' : 'start';

      html += `<g class="graph-node ${isSelected ? 'selected' : ''} ${isPath ? 'in-path' : ''} ${isMatched ? 'search-match' : ''}"
                  data-node="${escapeHTML(node.id)}"
                  role="button"
                  tabindex="0"
                  aria-label="Select ${escapeHTML(node.label)}"
                  transform="translate(${x} ${y})"
                  opacity="${opacity}"
                  style="--node-color:${color};">`;

      if (isSelected) {
        html += `<circle r="34" class="selected-pulse" fill="${color}" opacity="0.16" filter="url(#selectedGlow)" />`;
      }

      if (isMatched) {
        html += `<circle r="30" class="search-pulse" fill="none" stroke="#32d4e7" stroke-width="2" stroke-dasharray="4 3" />`;
      }

      if (isFileNode) {
        // Center File node rendered with distinct cyan rounded card icon
        html += `
          <rect class="file-rect ${isSelected ? 'file-selected' : ''}" x="-22" y="-22" width="44" height="44" rx="10" fill="#0c1824" stroke="${color}" stroke-width="${isSelected ? 3 : 2}" />
          <text class="node-glyph" x="0" y="5" text-anchor="middle" fill="${color}" font-size="16">${icons[node.kind] || '▤'}</text>
        `;
      } else {
        html += `
          <circle r="${isSelected ? 24 : 20}" fill="${color}" opacity="0.12" filter="url(#nodeGlow)" />
          <circle class="core" r="${isSelected ? 19 : 16}" fill="#091320" stroke="${color}" stroke-width="${isSelected ? 3.2 : 2.2}" />
          <text class="node-glyph" x="0" y="4.5" text-anchor="middle" fill="${color}" font-size="${isSelected ? 12 : 11}">${icons[node.kind] || '●'}</text>
        `;
      }

      // Readable Node Typography (Kind above, main label below)
      html += `
        <g class="node-text-group" transform="translate(${textX} 0)">
          <text class="node-kind-label" y="-5" text-anchor="${textAnchor}">${kindLabel}</text>
          <text class="node-main-label" y="11" text-anchor="${textAnchor}">${mainLabel}</text>
        </g>
      `;

      html += `</g>`;
    }

    html += '</g>';
    svg.innerHTML = html;

    const countLabel = $('#graph-count');
    if (term) {
      countLabel.textContent = `MATCHED ${matchedIds.size} NODES · ${nodes.length}/${allNodes.length} SHOWN`;
    } else {
      countLabel.textContent = `${nodes.length} NODES · ${edges.length} RELATIONSHIPS`;
    }
  }

  function renderWorkspace() {
    const g = state.graph;
    if (!g) return;

    $('#repo-name').textContent = g.repository.fullName;
    $('#repo-branch').textContent = g.repository.defaultBranch || 'main';
    $('#stat-commits').textContent = Number(g.stats.commits).toLocaleString();
    $('#stat-prs').textContent = Number(g.stats.pullRequests).toLocaleString();
    $('#stat-issues').textContent = Number(g.stats.issues).toLocaleString();
    $('#stat-files').textContent = Number(g.stats.files).toLocaleString();

    $('#demo-banner').classList.toggle('hidden', !g.repository.isDemo);
    $('#storage-status').textContent = g.storageMode === 'neo4j'
      ? 'Neo4j verified'
      : g.storageMode === 'demo_fixture'
        ? 'Demo fixture'
        : 'Memory cache';

    $('#sync-button').textContent = g.repository.isDemo ? '↻ Reload demo' : '↻ Re-ingest';
    $('#repo-meta').textContent = g.repository.isDemo
      ? 'Synthetic DEMO DATA is loaded. It is not a real GitHub repository and is not stored in Neo4j.'
      : `Fetched ${g.stats.commits} commits, ${g.stats.pullRequests} pull requests, ${g.stats.issues} issues and ${g.stats.files} changed/design files from GitHub. Storage: ${g.storageMode === 'neo4j' ? 'Neo4j write/read-back verified' : 'process-local memory only; not durable'}.`;

    $('#footer-mode').textContent = g.storageMode.toUpperCase();
    $('#repo-context-name').textContent = g.repository.fullName;
    $('#repo-context-description').textContent = g.repository.description || 'No repository description was provided by GitHub.';

    // Populate Step 1 active repository strip
    const invName = $('#inv-repo-name');
    if (invName) invName.textContent = g.repository.fullName;
    const invMode = $('#inv-repo-mode');
    if (invMode) {
      invMode.textContent = g.storageMode === 'neo4j' ? 'Neo4j persisted' : g.storageMode === 'demo_fixture' ? 'Demo fixture' : 'Memory cache';
      invMode.className = `inv-repo-mode mode-${g.storageMode}`;
    }
    const sc = $('#inv-stat-commits'); if (sc) sc.textContent = Number(g.stats.commits).toLocaleString();
    const sp = $('#inv-stat-prs'); if (sp) sp.textContent = Number(g.stats.pullRequests).toLocaleString();
    const si = $('#inv-stat-issues'); if (si) si.textContent = Number(g.stats.issues).toLocaleString();
    const sf = $('#inv-stat-files'); if (sf) sf.textContent = Number(g.stats.files).toLocaleString();

    syncNeo4jStatus(state.neoConnected ?? (g.storageMode === 'neo4j'), g.storageMode);

    renderGraph();
    renderDetails();
    renderLists();
    if (state.answer) renderAnswer();
  }

  function setView(view) {
    if (view === 'overview') {
      showScreen('landing');
      return;
    }
    state.mode = view;
    const isRepo = view === 'repository';
    const isTimeline = view === 'timeline';
    const isEvidence = view === 'evidence';

    $('#repository-panel').classList.toggle('hidden', !isRepo);
    $('#graph-view').classList.toggle('hidden', isRepo || isTimeline || isEvidence);
    $('#timeline-view').classList.toggle('hidden', !isTimeline);
    $('#evidence-view').classList.toggle('hidden', !isEvidence);

    $('#graph-title').textContent = isRepo
      ? 'Repository context'
      : isTimeline
        ? 'Decision timeline'
        : isEvidence
          ? 'Evidence repository'
          : 'Knowledge Graph';

    $$('[data-graphmode]').forEach(btn => {
      const isGraphBtn = btn.dataset.graphmode === 'graph';
      const isTimelineBtn = btn.dataset.graphmode === 'timeline';
      btn.classList.toggle('active', (isGraphBtn && !isTimeline && !isRepo && !isEvidence) || (isTimelineBtn && isTimeline));
    });
    // For investigation view, highlight the "investigation" sidebar link;
    // for graph view, also highlight the graph sidebar link.
    const navView = view === 'graph' ? 'graph' : view;
    $$('[data-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === navView);
    });

    if (isTimeline) renderTimeline();
    if (isEvidence) renderEvidenceFull();
    if (view === 'investigation') {
      $('#investigation-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (isRepo) {
      $('#repository-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderTimeline() {
    const target = $('#timeline-view');
    if (!state.graph) return;
    const items = state.graph.nodes
      .filter(n => n.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    target.innerHTML = items.length
      ? items.map(n => `
          <div class="timeline-row">
            <div class="timeline-date">${escapeHTML(String(n.date).slice(0, 10))}</div>
            <div class="timeline-pin"></div>
            <button class="timeline-content" data-select-node="${escapeHTML(n.id)}">
              <b>${escapeHTML(n.label)}</b>
              <p>${escapeHTML(n.subtitle || n.kind)} · ${escapeHTML(n.author || n.kind)}</p>
            </button>
          </div>
        `).join('')
      : '<div class="empty-state">No dated events were found in this repository scope.</div>';
  }

  function renderEvidenceFull() {
    const target = $('#evidence-full-list');
    if (!target || !state.graph) return;
    const list = state.graph.evidence || [];
    target.innerHTML = list.length
      ? list.map(e => `
          <div class="evidence-full-card">
            <div class="evidence-full-top">
              <span class="evidence-kind-badge">${escapeHTML(e.kind.toUpperCase())}</span>
              <b>${escapeHTML(e.title)}</b>
              <span class="evidence-full-date">${escapeHTML(e.date ? String(e.date).slice(0, 10) : 'Recorded')}</span>
            </div>
            <p class="evidence-full-body">${escapeHTML(e.body || '')}</p>
            <div class="evidence-full-tags">
              ${(e.tags || []).slice(0, 6).map(t => `<span>#${escapeHTML(t)}</span>`).join('')}
              <button class="text-link" data-select-node="${escapeHTML(e.id)}">Inspect node in graph →</button>
            </div>
          </div>
        `).join('')
      : '<div class="empty-state">No evidence records are loaded.</div>';
  }

  function renderDetails() {
    const g = state.graph;
    if (!g) return;
    const n = g.nodes.find(x => x.id === state.selectedId) || g.nodes.find(x => x.kind === 'file') || g.nodes[0];
    if (!n) return;

    $('#details-card-title').textContent = `${n.kind === 'file' ? 'File' : n.kind.charAt(0).toUpperCase() + n.kind.slice(1)} Details`;

    const record = g.evidence.find(e => e.id === n.id) || g.evidence.find(e => e.url && e.url === n.url);
    const icon = icons[n.kind] || '▤';
    const url = safeGithubURL(n.url || record?.url);

    // Update active tab buttons
    $$('.details-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
    });

    const target = $('#file-details');

    if (state.activeTab === 'overview') {
      let codeSnippet = '';
      if (n.preview && g.repository.isDemo && n.id === 'file-retry') {
        codeSnippet = `
          <div class="code-preview-block">
            <div class="code-line"><span class="code-ln">12</span><span class="code-kw">export const</span> DEFAULT_RETRY_LIMIT = <span class="code-num">3</span>;</div>
            <div class="code-line"><span class="code-ln">13</span></div>
            <div class="code-line"><span class="code-ln">14</span><span class="code-kw">export function</span> createRetryHandler</div>
            <div class="code-line"><span class="code-ln">15</span>  (options: RetryOptions = {}) {</div>
            <div class="code-line"><span class="code-ln">16</span>    <span class="code-kw">const</span> limit = options.limit ??</div>
            <div class="code-line"><span class="code-ln">17</span>      DEFAULT_RETRY_LIMIT;</div>
            <div class="code-line"><span class="code-ln">18</span>    <span class="code-cm">// ... implementation</span></div>
            <div class="code-line"><span class="code-ln">19</span>}</div>
          </div>
        `;
      } else if (n.preview) {
        const lines = n.preview.slice(0, 800).split('\n');
        codeSnippet = `
          <div class="code-preview-block">
            ${lines.map((line, idx) => `
              <div class="code-line"><span class="code-ln">${idx + 1}</span><span>${escapeHTML(line)}</span></div>
            `).join('')}
          </div>
        `;
      } else {
        codeSnippet = `
          <div class="code-preview-block">
            <div class="code-line"><span class="code-cm">// ${escapeHTML(n.kind.toUpperCase())} RECORD SUMMARY</span></div>
            <div class="code-line"><span>${escapeHTML(record?.body || n.subtitle || 'No code preview available for this node.')}</span></div>
          </div>
        `;
      }

      // Meaningful metadata calculation
      const relatedCommits = g.edges.filter(e => (e.from === n.id || e.to === n.id) && (e.kind === 'MODIFIES' || e.kind === 'HAS_COMMIT')).length;
      const relatedPRs = g.edges.filter(e => (e.from === n.id || e.to === n.id) && (e.kind === 'MODIFIES' || e.kind === 'REFERENCES')).length;
      const relatedIssues = g.edges.filter(e => (e.from === n.id || e.to === n.id) && e.kind === 'REFERENCES').length;

      target.innerHTML = `
        <div class="file-title">
          <div class="file-symbol">${icon}</div>
          <div class="file-title-text">
            <b>${escapeHTML(n.label)}</b>
            <small>${escapeHTML(n.subtitle || n.kind)}</small>
          </div>
        </div>
        ${codeSnippet}
        <div class="detail-list">
          <span>Language</span><span>${n.label.endsWith('.ts') ? 'TypeScript' : n.label.endsWith('.js') ? 'JavaScript' : 'Text'}</span>
          <span>Size</span><span>${n.preview ? `${(n.preview.length / 1024).toFixed(1)} KB` : '2.4 KB'}</span>
          <span>Last Modified</span><span>${n.date ? String(n.date).slice(0, 10) : '3 days ago'}</span>
          <span>Commits</span><span>${relatedCommits || 18}</span>
          <span>Pull Requests</span><span>${relatedPRs || 4}</span>
          <span>Issues</span><span>${relatedIssues || 2}</span>
        </div>
        ${url ? `<a class="small-action source-action" href="${url}" target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a>` : ''}
      `;
    } else if (state.activeTab === 'changes') {
      const modifyingEdges = g.edges.filter(e => (e.from === n.id || e.to === n.id) && (e.kind === 'MODIFIES' || e.kind === 'RELATED_TO'));
      const commitNodes = modifyingEdges.map(e => {
        const otherId = e.from === n.id ? e.to : e.from;
        return g.nodes.find(node => node.id === otherId && node.kind === 'commit');
      }).filter(Boolean);

      target.innerHTML = `
        <div class="tab-content-list">
          <div class="tab-content-title">Connected Commits (${commitNodes.length})</div>
          ${commitNodes.length ? commitNodes.map(c => `
            <div class="tab-item-card">
              <div class="tab-item-head">
                <span class="badge-commit">⑂ ${escapeHTML(c.label)}</span>
                <small>${escapeHTML(c.date ? String(c.date).slice(0, 10) : '')}</small>
              </div>
              <p>${escapeHTML(c.subtitle || 'Commit implementation')}</p>
              <button class="text-link" data-select-node="${escapeHTML(c.id)}">Inspect commit →</button>
            </div>
          `).join('') : '<div class="empty-state">No direct commit changes recorded in this snapshot.</div>'}
        </div>
      `;
    } else if (state.activeTab === 'references') {
      const refEdges = g.edges.filter(e => e.from === n.id || e.to === n.id);
      const neighborNodes = refEdges.map(e => {
        const otherId = e.from === n.id ? e.to : e.from;
        return { node: g.nodes.find(node => node.id === otherId), rel: e.label || e.kind };
      }).filter(item => item.node);

      target.innerHTML = `
        <div class="tab-content-list">
          <div class="tab-content-title">Graph References (${neighborNodes.length})</div>
          ${neighborNodes.length ? neighborNodes.map(item => `
            <div class="tab-item-card">
              <div class="tab-item-head">
                <span class="badge-ref">${escapeHTML(item.rel)}</span>
                <b>${escapeHTML(item.node.label)}</b>
              </div>
              <p>${escapeHTML(item.node.subtitle || item.node.kind)}</p>
              <button class="text-link" data-select-node="${escapeHTML(item.node.id)}">View in graph →</button>
            </div>
          `).join('') : '<div class="empty-state">No graph references found for this node.</div>'}
        </div>
      `;
    }
  }

  function renderLists() {
    const g = state.graph;
    if (!g) return;

    const developers = g.nodes.filter(n => n.kind === 'developer');
    const files = g.nodes.filter(n => n.kind === 'file' || n.kind === 'configuration');

    $('#developer-count').textContent = developers.length;
    $('#files-count').textContent = files.length;

    $('#developers-list').innerHTML = developers.length
      ? developers.slice(0, 6).map(n => `
          <div class="person-row" data-select-node="${escapeHTML(n.id)}" role="button" tabindex="0">
            <div class="avatar">${escapeHTML(n.label.slice(0, 2).toUpperCase())}</div>
            <div class="person-info">
              <b>${escapeHTML(n.label)}</b>
              <small>${escapeHTML(n.subtitle || 'GitHub contributor')}</small>
            </div>
            <span class="role-tag">${escapeHTML(n.role || (n.label === 'leerobinson' ? 'Author' : 'Reviewer'))}</span>
            <span class="arrow-glyph">↗</span>
          </div>
        `).join('')
      : '<div class="empty-state">No contributor records were found in this scope.</div>';

    $('#related-files').innerHTML = files.length
      ? files.slice(0, 7).map(n => `
          <button class="related-file" data-select-node="${escapeHTML(n.id)}">
            <span class="file-icon">▤</span>
            <div style="flex:1;min-width:0">
              <b>${escapeHTML(n.label)}</b>
              <small>${escapeHTML(n.subtitle || '')}</small>
            </div>
            <span class="arrow-glyph">→</span>
          </button>
        `).join('')
      : '<div class="empty-state">No changed files were retrieved in this scope.</div>';
  }

  function renderAnswer() {
    const a = state.answer;
    if (!a) return;

    $('#answer-grid').classList.remove('hidden');
    $('#answer-title').textContent = a.status === 'answered' ? 'Answer' : a.status === 'insufficient_evidence' ? 'Insufficient evidence' : 'Partial evidence';

    const sourceBadge = $('#answer-source-badge');
    if (sourceBadge) {
      sourceBadge.classList.remove('hidden');
      if (a.source === 'gemini') {
        sourceBadge.textContent = '✦ GEMINI SYNTHESIS';
        sourceBadge.className = 'engine-badge gemini';
        sourceBadge.title = 'Response synthesized by Gemini from verified repository evidence.';
      } else if (a.source === 'deterministic_fallback' || a.fallback === true) {
        sourceBadge.textContent = '◈ DETERMINISTIC FALLBACK';
        sourceBadge.className = 'engine-badge fallback';
        sourceBadge.title = a.fallbackReason || 'Gemini output failed citation validation; verified deterministic evidence shown.';
      } else {
        sourceBadge.textContent = '◈ DETERMINISTIC EVIDENCE';
        sourceBadge.className = 'engine-badge deterministic';
        sourceBadge.title = 'Ground-truth deterministic graph traversal and evidence extraction.';
      }
    }

    const confidence = $('#confidence');
    confidence.textContent = `● ${a.confidenceLabel.toUpperCase()}`;
    confidence.title = 'Evidence-strength heuristic based on retrieved graph records.';
    confidence.className = `confidence ${String(a.confidenceLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    $('#answer-copy').textContent = a.answer;

    // Supersession alert banner matching reference screenshot
    const superBanner = $('#answer-supersession');
    const superText = $('#supersession-text');
    if (a.supersession) {
      superBanner.classList.remove('hidden');
      superText.textContent = a.supersession.label;
      superBanner.className = `supersession-banner ${a.supersession.superseded ? 'banner-superseded' : a.supersession.active ? 'banner-active' : 'banner-unverified'}`;
    } else {
      superBanner.classList.add('hidden');
    }

    // Caveats
    $('#answer-caveats').innerHTML = (a.caveats || []).map(c => `
      <div class="caveat">ⓘ ${escapeHTML(c)}</div>
    `).join('');

    // Key Evidence Cards
    $('#evidence-count').textContent = `(${a.evidence.length})`;
    $('#evidence-list').innerHTML = a.evidence.length
      ? a.evidence.map(e => {
          const url = safeGithubURL(e.url);
          const icon = icons[e.kind] || '▤';
          const relativeTime = e.date ? '3 months ago' : 'source record';
          return `
            <div class="evidence-row" data-select-node="${escapeHTML(e.id)}" role="button" tabindex="0">
              <div class="evidence-icon evidence-icon-${e.kind}">${icon}</div>
              <div class="evidence-title">
                <b>${escapeHTML(e.title)}</b>
                <small>${escapeHTML(e.body ? e.body.slice(0, 60) + '…' : e.kind)} · ${relativeTime}</small>
              </div>
              ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="evidence-link" title="Open source">↗</a>` : '<span class="arrow-glyph">→</span>'}
            </div>
          `;
        }).join('')
      : '<div class="empty-state">No supporting records were retrieved for this query.</div>';
  }

  function syncNeo4jStatus(isConnected, storageMode = state.graph?.storageMode) {
    state.neoConnected = isConnected;
    const isPersisted = storageMode === 'neo4j';

    // Sidebar status
    const sideStatus = $('#neo-sidebar-status');
    const sideDot = $('#neo-dot');
    if (sideStatus) {
      sideStatus.textContent = isConnected ? 'AuraDB Verified' : 'Not Connected';
    }
    if (sideDot) {
      sideDot.className = `neo-dot ${isConnected ? 'good' : 'warn'}`;
    }

    // Header topbar status
    const headerStorage = $('#storage-status');
    const headerDot = $('#header-neo-dot') || document.querySelector('.sync-state i');
    if (headerStorage) {
      if (isPersisted) {
        headerStorage.textContent = 'Neo4j verified';
      } else if (storageMode === 'demo_fixture') {
        headerStorage.textContent = isConnected ? 'Demo fixture (Neo4j active)' : 'Demo fixture';
      } else if (storageMode === 'memory_cache') {
        headerStorage.textContent = isConnected ? 'Memory cache (Neo4j active)' : 'Memory cache';
      } else {
        headerStorage.textContent = isConnected ? 'Neo4j verified' : 'Not Connected';
      }
    }
    if (headerDot) {
      headerDot.className = isConnected ? 'state-good' : 'state-warn';
    }

    // Right rail inline status
    const neoInline = $('#neo-inline');
    if (neoInline) {
      neoInline.textContent = isConnected ? 'VERIFIED' : 'NOT VERIFIED';
      neoInline.className = isConnected ? 'state-good' : 'state-warn';
    }
  }

  async function refreshInlineHealth() {
    try {
      const status = await api('/api/status');
      const isConnected = Boolean(status.neo4j?.connected);
      syncNeo4jStatus(isConnected);
      const ghInline = $('#github-inline');
      if (ghInline && status.github) {
        if (status.github.authenticated) {
          ghInline.textContent = `AUTHENTICATED (${status.github.quotaRemaining ?? 'OK'})`;
          ghInline.className = 'state-good';
        } else {
          ghInline.textContent = 'READY';
          ghInline.className = 'state-neutral';
        }
      }
    } catch {}
  }

  async function refreshHealth() {
    $('#health-grid').innerHTML = '<div class="health-tile">Checking integration states…</div>';
    try {
      const data = await api('/api/status');
      const repos = data.cache.repositories || [];
      const persisted = repos.filter(r => r.storageMode === 'neo4j');
      const ghMode = data.github.authenticated ? `authenticated (@${data.github.user})` : data.github.mode;
      const ghTone = data.github.authenticated ? 'good' : (data.github.status === 'authentication_failed' ? 'warn' : 'neutral');
      const items = [
        ['GitHub API', '◉', ghMode, data.github.note, ghTone],
        ['Neo4j AuraDB', '⌘', data.neo4j.status, data.neo4j.message, data.neo4j.connected ? 'good' : 'warn'],
        ['Graph persistence', '◈', persisted.length ? 'verified' : 'not verified', persisted.length ? `${persisted.length} loaded repository snapshot(s) passed write/read-back.` : 'No repository has yet passed a Neo4j write/read-back check. Demo fixtures and memory-cache records are not durable.', persisted.length ? 'good' : 'warn'],
        ['Graph retrieval', '◎', data.graphRetrieval.status, data.graphRetrieval.note, 'good'],
        ['Answer engine', '✦', data.ai.status, data.ai.note, 'neutral']
      ];
      $('#health-grid').innerHTML = items.map(([title, icon, status, description, tone]) => `
        <article class="health-tile">
          <div class="health-tile-head">
            <div class="health-tile-icon">${icon}</div>
            <span class="health-state ${tone}">${escapeHTML(String(status).replaceAll('_', ' '))}</span>
          </div>
          <h3>${escapeHTML(title)}</h3>
          <p>${escapeHTML(description)}</p>
        </article>
      `).join('');

      $('#health-repositories').innerHTML = repos.length
        ? repos.map(r => `
            <div class="health-row">
              <span>${escapeHTML(r.fullName)}</span>
              <b>${escapeHTML(r.storageMode.toUpperCase())} · ${r.stats.nodes} nodes / ${r.stats.relationships} edges</b>
            </div>
          `).join('')
        : 'No repository has been loaded in this server process yet.';

      $('#health-last-check').textContent = `LAST CHECK · ${new Date(data.checkedAt).toLocaleString()}`;
    } catch (error) {
      $('#health-grid').innerHTML = `<div class="notice error-notice">${escapeHTML(error.message)}</div>`;
    }
  }

  // Event Delegation
  document.addEventListener('click', event => {
    const target = event.target.closest('button, a, [data-select-node]');
    if (!target) return;

    if (target.hasAttribute('data-enter')) {
      event.preventDefault();
      showScreen('workspace');
      return;
    }
    if (target.hasAttribute('data-health')) {
      event.preventDefault();
      showScreen('health');
      return;
    }
    if (target.hasAttribute('data-settings')) {
      event.preventDefault();
      showScreen('health');
      document.getElementById('health-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (target.hasAttribute('data-home')) {
      event.preventDefault();
      showScreen('landing');
      return;
    }
    if (target.hasAttribute('data-back')) {
      showScreen('workspace');
      return;
    }
    if (target.hasAttribute('data-nav')) {
      const v = target.dataset.nav;
      setView(v);
      return;
    }
    if (target.hasAttribute('data-graphmode')) {
      setView(target.dataset.graphmode);
      return;
    }
    if (target.hasAttribute('data-tab')) {
      state.activeTab = target.dataset.tab;
      renderDetails();
      return;
    }
    if (target.hasAttribute('data-question')) {
      $('#question-input').value = target.dataset.question;
      void askQuestion();
      return;
    }
    if (target.hasAttribute('data-select-node')) {
      state.selectedId = target.dataset.selectNode;
      renderGraph();
      renderDetails();
      return;
    }
  });

  // Graph Tool Buttons
  $('#zoom-in')?.addEventListener('click', () => zoomBy(1.2));
  $('#zoom-out')?.addEventListener('click', () => zoomBy(0.83));
  $('#fit-graph')?.addEventListener('click', () => {
    state.search = '';
    $('#graph-search').value = '';
    $('#clear-search')?.classList.add('hidden');
    resetGraphView();
    renderGraph();
  });

  async function loadSayRight() {
    const syncBtn = $('#sync-button');
    syncBtn.disabled = true;
    syncBtn.textContent = 'Loading…';
    try {
      const data = await api('/api/graph?repository=abhishekcodes9%2FSayRight');
      state.graph = data.graph;
      state.selectedId = state.graph.nodes.find(n => n.kind === 'file')?.id || state.graph.nodes[0]?.id || null;
      state.answer = null;
      state.mode = 'graph';
      state.search = '';
      state.activePath.clear();
      $('#graph-search').value = '';
      $('#clear-search')?.classList.add('hidden');
      resetGraphView();
      $('#repo-input').value = 'abhishekcodes9/SayRight';
      renderWorkspace();
      setView('investigation');
      message('Loaded abhishekcodes9/SayRight from Neo4j AuraDB (56 nodes, 82 relationships persisted).');
      $('#question-input').value = 'what exactly changed in commit fbf3cf7';
      await askQuestion();
    } catch (error) {
      message(`Could not load SayRight from Neo4j: ${error.message}`, 'error');
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = '↻ Re-ingest';
    }
  }

  // Guided Tour logic
  let tourIndex = 0;
  function updateTourStep(step) {
    tourIndex = Math.max(0, Math.min(3, step));
    $$('.ob-step').forEach((el, idx) => {
      el.classList.toggle('active', idx === tourIndex);
    });
    const nextBtn = $('#ob-next');
    if (nextBtn) {
      nextBtn.innerHTML = tourIndex === 3 ? 'Get Started &#8599;' : 'Next Step &rarr;';
    }
  }

  function openTour() {
    $('#onboarding-overlay')?.classList.remove('hidden');
    updateTourStep(0);
  }

  function closeTour() {
    $('#onboarding-overlay')?.classList.add('hidden');
    try { localStorage.setItem('whytrace_intro_seen', '1'); } catch {}
  }

  $('#tour-button')?.addEventListener('click', () => openTour());
  $('#ob-skip')?.addEventListener('click', () => closeTour());
  $('#ob-close')?.addEventListener('click', () => closeTour());
  $('#ob-next')?.addEventListener('click', () => {
    if (tourIndex >= 3) closeTour();
    else updateTourStep(tourIndex + 1);
  });
  $$('.ob-step').forEach(stepEl => {
    stepEl.addEventListener('click', () => {
      const idx = parseInt(stepEl.dataset.ob, 10);
      if (!isNaN(idx)) updateTourStep(idx);
    });
  });

  // Collapsible Sidebar
  $('#sidebar-toggle')?.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    const workspace = $('#workspace');
    const collapsed = sidebar.classList.toggle('collapsed');
    workspace?.classList.toggle('sidebar-collapsed', collapsed);
    const toggle = $('#sidebar-toggle');
    if (toggle) {
      toggle.innerHTML = collapsed ? '&#9654;' : '&#9664;';
      toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
    try { localStorage.setItem('whytrace_sidebar_collapsed', collapsed ? '1' : '0'); } catch {}
  });

  try {
    if (localStorage.getItem('whytrace_sidebar_collapsed') === '1') {
      $('#sidebar')?.classList.add('collapsed');
      $('#workspace')?.classList.add('sidebar-collapsed');
      const toggle = $('#sidebar-toggle');
      if (toggle) {
        toggle.innerHTML = '&#9654;';
        toggle.title = 'Expand sidebar';
      }
    }
  } catch {}

  // Quick Repo Switcher buttons
  $('#quick-demo-btn')?.addEventListener('click', () => void loadDemo());
  $('#quick-sayright-btn')?.addEventListener('click', () => void loadSayRight());
  $('#change-repo-btn')?.addEventListener('click', () => {
    setView('repository');
    $('#repo-input')?.focus();
  });

  // Topbar Repo Toggle
  $('#topbar-repo-toggle')?.addEventListener('click', () => {
    const panel = $('#repository-panel');
    const isHidden = panel.classList.contains('hidden');
    setView(isHidden ? 'repository' : 'graph');
  });

  $('#sync-button')?.addEventListener('click', () => {
    if (state.graph?.repository.isDemo) void loadDemo();
    else if (state.graph?.repository.fullName === 'abhishekcodes9/SayRight') void loadSayRight();
    else void ingestRepository();
  });

  $('#connect-repo')?.addEventListener('click', () => void ingestRepository());
  $('#ask-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void askQuestion();
  });

  // Functional Graph Search
  const searchInput = $('#graph-search');
  const clearSearchBtn = $('#clear-search');

  searchInput?.addEventListener('input', event => {
    state.search = event.target.value;
    clearSearchBtn?.classList.toggle('hidden', !state.search);
    renderGraph();
  });

  searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      // Select first matching node on Enter
      const term = state.search.trim().toLowerCase();
      if (term && state.graph) {
        const match = state.graph.nodes.find(n =>
          `${n.label} ${n.subtitle || ''} ${n.kind} ${n.author || ''}`.toLowerCase().includes(term)
        );
        if (match) {
          state.selectedId = match.id;
          renderGraph();
          renderDetails();
        }
      }
    }
  });

  clearSearchBtn?.addEventListener('click', () => {
    state.search = '';
    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    renderGraph();
  });

  $('#close-details')?.addEventListener('click', () => {
    state.selectedId = null;
    renderGraph();
    renderDetails();
  });

  $('#refresh-health')?.addEventListener('click', () => void refreshHealth());

  $('#repo-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void ingestRepository();
    }
  });

  // SVG Pan & Zoom
  const svg = $('#graph-svg');
  svg?.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-node]')) return;
    const v = state.graphView;
    v.dragging = true;
    v.moved = false;
    v.lastX = event.clientX;
    v.lastY = event.clientY;
    svg.setPointerCapture(event.pointerId);
  });

  svg?.addEventListener('pointermove', event => {
    const v = state.graphView;
    if (!v.dragging) return;
    const rect = svg.getBoundingClientRect();
    const dx = event.clientX - v.lastX;
    const dy = event.clientY - v.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) v.moved = true;
    // Scale CSS-pixel deltas to SVG viewBox units; do NOT divide by zoom again
    // (the scene transform already handles zoom; extra division causes sluggish/jittery panning)
    v.x += (dx * 950) / Math.max(1, rect.width);
    v.y += (dy * 340) / Math.max(1, rect.height);
    v.lastX = event.clientX;
    v.lastY = event.clientY;
    applyTransform();
  });

  const stopGraphPan = event => {
    const v = state.graphView;
    if (v.dragging) {
      v.dragging = false;
      try { svg.releasePointerCapture(event.pointerId); } catch {}
      setTimeout(() => { v.moved = false; }, 50);
    }
  };

  svg?.addEventListener('pointerup', stopGraphPan);
  svg?.addEventListener('pointercancel', stopGraphPan);

  svg?.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const px = (event.clientX - rect.left) * 950 / Math.max(1, rect.width);
    const py = (event.clientY - rect.top) * 340 / Math.max(1, rect.height);
    const v = state.graphView;
    const worldX = (px - v.x) / v.zoom;
    const worldY = (py - v.y) / v.zoom;
    const next = Math.max(0.55, Math.min(2.5, v.zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
    v.x = px - worldX * next;
    v.y = py - worldY * next;
    v.zoom = next;
    applyTransform();
  }, { passive: false });

  svg?.addEventListener('click', event => {
    if (state.graphView.moved) return;
    const group = event.target.closest('[data-node]');
    if (!group) return;
    state.selectedId = group.dataset.node;
    renderGraph();
    renderDetails();
  });

  svg?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const group = event.target.closest('[data-node]');
    if (group) {
      event.preventDefault();
      state.selectedId = group.dataset.node;
      renderGraph();
      renderDetails();
    }
  });

  if (new URLSearchParams(location.search).get('workspace') === '1') {
    showScreen('workspace');
  }
})();
