export const APP_CSS = `
:root {
  --bg-canvas-light: #f6f8fb;
  --bg-canvas-dark: #0e131b;
  --bg-surface-light: #ffffff;
  --bg-surface-dark: #161e2b;
  --bg-subtle-light: #eef2f8;
  --bg-subtle-dark: #1f2a3c;
  --text-main-light: #131a24;
  --text-main-dark: #e8eef7;
  --text-muted-light: #526075;
  --text-muted-dark: #97a6bc;
  --border-light: #d7e0ec;
  --border-dark: #2c3a50;

  --brand-light: #1d4ed8;
  --brand-dark: #60a5fa;
  --brand-ink-light: #ffffff;
  --brand-ink-dark: #0b1629;

  --ok-bg-light: #dcfce7;
  --ok-bg-dark: #133926;
  --ok-fg-light: #166534;
  --ok-fg-dark: #86efac;

  --warn-bg-light: #fef3c7;
  --warn-bg-dark: #3f2d0c;
  --warn-fg-light: #92400e;
  --warn-fg-dark: #fcd34d;

  --err-bg-light: #fee2e2;
  --err-bg-dark: #45171b;
  --err-fg-light: #991b1b;
  --err-fg-dark: #fca5a5;

  --prov-entity-fill-light: #fef9c3;
  --prov-entity-fill-dark: #3b3312;
  --prov-entity-stroke-light: #ca8a04;
  --prov-entity-stroke-dark: #facc15;

  --prov-activity-fill-light: #dbeafe;
  --prov-activity-fill-dark: #172b4d;
  --prov-activity-stroke-light: #2563eb;
  --prov-activity-stroke-dark: #60a5fa;

  --prov-agent-fill-light: #ffedd5;
  --prov-agent-fill-dark: #432411;
  --prov-agent-stroke-light: #ea580c;
  --prov-agent-stroke-dark: #fb923c;

  /* Fallback assignments for browsers without light-dark() */
  --bg-canvas: var(--bg-canvas-light);
  --bg-surface: var(--bg-surface-light);
  --bg-subtle: var(--bg-subtle-light);
  --text-main: var(--text-main-light);
  --text-muted: var(--text-muted-light);
  --border-color: var(--border-light);
  --brand: var(--brand-light);
  --brand-ink: var(--brand-ink-light);
  --ok-bg: var(--ok-bg-light);
  --ok-fg: var(--ok-fg-light);
  --warn-bg: var(--warn-bg-light);
  --warn-fg: var(--warn-fg-light);
  --err-bg: var(--err-bg-light);
  --err-fg: var(--err-fg-light);
  --prov-entity-fill: var(--prov-entity-fill-light);
  --prov-entity-stroke: var(--prov-entity-stroke-light);
  --prov-activity-fill: var(--prov-activity-fill-light);
  --prov-activity-stroke: var(--prov-activity-stroke-light);
  --prov-agent-fill: var(--prov-agent-fill-light);
  --prov-agent-stroke: var(--prov-agent-stroke-light);

  @media (prefers-color-scheme: dark) {
    --bg-canvas: var(--bg-canvas-dark);
    --bg-surface: var(--bg-surface-dark);
    --bg-subtle: var(--bg-subtle-dark);
    --text-main: var(--text-main-dark);
    --text-muted: var(--text-muted-dark);
    --border-color: var(--border-dark);
    --brand: var(--brand-dark);
    --brand-ink: var(--brand-ink-dark);
    --ok-bg: var(--ok-bg-dark);
    --ok-fg: var(--ok-fg-dark);
    --warn-bg: var(--warn-bg-dark);
    --warn-fg: var(--warn-fg-dark);
    --err-bg: var(--err-bg-dark);
    --err-fg: var(--err-fg-dark);
    --prov-entity-fill: var(--prov-entity-fill-dark);
    --prov-entity-stroke: var(--prov-entity-stroke-dark);
    --prov-activity-fill: var(--prov-activity-fill-dark);
    --prov-activity-stroke: var(--prov-activity-stroke-dark);
    --prov-agent-fill: var(--prov-agent-fill-dark);
    --prov-agent-stroke: var(--prov-agent-stroke-dark);
  }

  @supports (color: light-dark(white, black)) {
    --bg-canvas: light-dark(var(--bg-canvas-light), var(--bg-canvas-dark));
    --bg-surface: light-dark(var(--bg-surface-light), var(--bg-surface-dark));
    --bg-subtle: light-dark(var(--bg-subtle-light), var(--bg-subtle-dark));
    --text-main: light-dark(var(--text-main-light), var(--text-main-dark));
    --text-muted: light-dark(var(--text-muted-light), var(--text-muted-dark));
    --border-color: light-dark(var(--border-light), var(--border-dark));
    --brand: light-dark(var(--brand-light), var(--brand-dark));
    --brand-ink: light-dark(var(--brand-ink-light), var(--brand-ink-dark));
    --ok-bg: light-dark(var(--ok-bg-light), var(--ok-bg-dark));
    --ok-fg: light-dark(var(--ok-fg-light), var(--ok-fg-dark));
    --warn-bg: light-dark(var(--warn-bg-light), var(--warn-bg-dark));
    --warn-fg: light-dark(var(--warn-fg-light), var(--warn-fg-dark));
    --err-bg: light-dark(var(--err-bg-light), var(--err-bg-dark));
    --err-fg: light-dark(var(--err-fg-light), var(--err-fg-dark));
    --prov-entity-fill: light-dark(var(--prov-entity-fill-light), var(--prov-entity-fill-dark));
    --prov-entity-stroke: light-dark(var(--prov-entity-stroke-light), var(--prov-entity-stroke-dark));
    --prov-activity-fill: light-dark(var(--prov-activity-fill-light), var(--prov-activity-fill-dark));
    --prov-activity-stroke: light-dark(var(--prov-activity-stroke-light), var(--prov-activity-stroke-dark));
    --prov-agent-fill: light-dark(var(--prov-agent-fill-light), var(--prov-agent-fill-dark));
    --prov-agent-stroke: light-dark(var(--prov-agent-stroke-light), var(--prov-agent-stroke-dark));
  }

  color-scheme: light dark;
  accent-color: var(--brand);
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
  background-color: var(--bg-canvas);
  color: var(--text-main);
}

code, pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.86rem;
}

.app-shell {
  max-inline-size: 1400px;
  margin-inline: auto;
  padding-inline: 1.25rem;
  padding-block: 1.25rem 3rem;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-areas:
    "header"
    "kpis"
    "loaders"
    "explorer"
    "reports";
  gap: 1.25rem;
}

.app-header {
  grid-area: header;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding-inline: 1.25rem;
  padding-block: 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: safe center;
  gap: 1rem;
}

.header-actions {
  margin-inline-start: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: safe center;
  gap: 0.6rem;
}

.app-title {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: -0.01em;
}

.app-subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.kpi-section { grid-area: kpis; }
.loaders-section { grid-area: loaders; }
.explorer-section { grid-area: explorer; }
.reports-section { grid-area: reports; display: grid; gap: 1.25rem; }

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 0.85rem;
}

.kpi-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 0.65rem;
  padding-inline: 1rem;
  padding-block: 0.85rem;
}

.kpi-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.kpi-value {
  font-size: 1.55rem;
  font-weight: 700;
  margin-block-start: 0.2rem;
}

.kpi-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding-inline: 1.25rem;
  padding-block: 1.1rem;
}

.panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: safe center;
  gap: 0.75rem;
  margin-block-end: 0.9rem;
}

.panel-header h2 {
  margin: 0;
  font-size: 1.1rem;
}

.panel-header p {
  margin: 0;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.panel-actions {
  margin-inline-start: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

button, .btn {
  appearance: none;
  border: 1px solid var(--border-color);
  background: var(--bg-subtle);
  color: var(--text-main);
  border-radius: 0.45rem;
  padding-inline: 0.8rem;
  padding-block: 0.42rem;
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: safe center;
  gap: 0.35rem;
}

button:hover, .btn:hover {
  border-color: var(--brand);
}

button.primary, .btn.primary {
  background: var(--brand);
  color: var(--brand-ink);
  border-color: var(--brand);
}

button.small, .btn.small {
  padding-inline: 0.55rem;
  padding-block: 0.25rem;
  font-size: 0.78rem;
}

.loaders-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
}

.loader-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.8rem;
}

.loader-card {
  border: 1px solid var(--border-color);
  border-radius: 0.6rem;
  padding-inline: 0.9rem;
  padding-block: 0.8rem;
  background: var(--bg-canvas);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-inline-size: 0;
}

.loader-top {
  display: flex;
  align-items: safe center;
  gap: 0.5rem;
}

.loader-title {
  font-weight: 650;
  font-size: 0.92rem;
  min-inline-size: 0;
}

.badge {
  display: inline-block;
  padding-inline: 0.5rem;
  padding-block: 0.12rem;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 650;
  white-space: nowrap;
}

.badge.ok, .badge.completed, .badge.verified {
  background: var(--ok-bg);
  color: var(--ok-fg);
}

.badge.warn, .badge.running, .badge.untested {
  background: var(--warn-bg);
  color: var(--warn-fg);
}

.badge.err, .badge.failed, .badge.unimplemented, .badge.high {
  background: var(--err-bg);
  color: var(--err-fg);
}

.badge.idle, .badge.neutral, .badge.medium {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.progress-track {
  inline-size: 100%;
  block-size: 0.45rem;
  background: var(--bg-subtle);
  border-radius: 999px;
  overflow: clip;
}

.progress-fill {
  block-size: 100%;
  background: var(--brand);
  transition: inline-size 180ms ease;
}

.loader-msg {
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.log-feed {
  max-block-size: 240px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  background: var(--bg-canvas);
  border: 1px solid var(--border-color);
  border-radius: 0.55rem;
  padding-inline: 0.75rem;
  padding-block: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
}

.log-line {
  padding-block: 0.2rem;
  border-block-end: 1px solid var(--border-color);
  display: flex;
  gap: 0.5rem;
}

.log-line:last-child {
  border-block-end: none;
}

.filter-pills {
  display: flex;
  flex-wrap: wrap;
  flex-wrap: balance;
  gap: 0.45rem;
  margin-block-end: 0.85rem;
}

.pill {
  font-size: 0.78rem;
  padding-inline: 0.65rem;
  padding-block: 0.28rem;
  border-radius: 999px;
}

.pill.active {
  background: var(--brand);
  color: var(--brand-ink);
  border-color: var(--brand);
}

.explorer-split {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(290px, 1fr);
  gap: 1rem;
  align-items: start;
}

@media (max-width: 980px) {
  .explorer-split {
    grid-template-columns: 1fr;
  }
}

.graph-scroll {
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  border: 1px solid var(--border-color);
  border-radius: 0.6rem;
  background: var(--bg-canvas);
  max-block-size: 560px;
}

.prov-svg {
  display: block;
}

.prov-node {
  cursor: pointer;
}

.prov-node:hover rect,
.prov-node:hover polygon {
  stroke-width: 2.5px;
}

.inspector-box {
  border: 1px solid var(--border-color);
  border-radius: 0.6rem;
  background: var(--bg-canvas);
  padding-inline: 0.95rem;
  padding-block: 0.85rem;
  max-block-size: 560px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  min-inline-size: 0;
}

.rel-list {
  list-style: none;
  padding: 0;
  margin: 0.4rem 0 0.85rem;
  display: grid;
  gap: 0.35rem;
}

.rel-item {
  font-size: 0.82rem;
  padding-inline: 0.55rem;
  padding-block: 0.35rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 0.4rem;
  display: flex;
  flex-wrap: wrap;
  align-items: safe center;
  gap: 0.35rem;
}

.anomaly-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.85rem;
}

.anomaly-card {
  border: 1px solid var(--border-color);
  border-inline-start: 4px solid var(--err-fg);
  border-radius: 0.55rem;
  padding-inline: 0.9rem;
  padding-block: 0.75rem;
  background: var(--bg-canvas);
}

/* Responsive Data Table (following modern-web-guidance responsive-table) */
.table-wrapper {
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  max-inline-size: 100%;
  max-block-size: min(520px, 80dvh);
  container-type: inline-size;
  border: 1px solid var(--border-color);
  border-radius: 0.6rem;
}

table.data-table {
  inline-size: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.85rem;
}

table.data-table caption {
  text-align: start;
  padding-inline: 0.85rem;
  padding-block: 0.55rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-subtle);
  border-block-end: 1px solid var(--border-color);
}

table.data-table thead {
  position: sticky;
  inset-block-start: 0;
  z-index: 2;
}

table.data-table th,
table.data-table td {
  padding-inline: 0.75rem;
  padding-block: 0.6rem;
  text-align: start;
  vertical-align: top;
  border-block-end: 1px solid var(--border-color);
}

table.data-table thead th {
  background: var(--bg-subtle);
  font-weight: 650;
}

table.data-table tbody th {
  position: sticky;
  inset-inline-start: 0;
  z-index: 1;
  background: var(--bg-surface);
  font-weight: 600;
}

@container (width < 600px) {
  table.data-table,
  table.data-table thead,
  table.data-table tbody,
  table.data-table tr,
  table.data-table th,
  table.data-table td {
    display: block;
  }

  table.data-table thead {
    display: none;
  }

  table.data-table tr {
    margin-block-end: 1rem;
    border: 1px solid var(--border-color);
  }

  table.data-table tbody th {
    position: sticky;
    inset-block-start: 0;
    z-index: 2;
    background: var(--bg-subtle);
  }

  table.matrix-table {
    --label-2: "Status";
    --label-3: "GitHub Issues";
    --label-4: "Pull Requests";
    --label-5: "Commits";
    --label-6: "Code & Tests";
  }

  table.matrix-table td:nth-child(2)::before { content: var(--label-2) ": "; font-weight: 600; }
  table.matrix-table td:nth-child(3)::before { content: var(--label-3) ": "; font-weight: 600; }
  table.matrix-table td:nth-child(4)::before { content: var(--label-4) ": "; font-weight: 600; }
  table.matrix-table td:nth-child(5)::before { content: var(--label-5) ": "; font-weight: 600; }
  table.matrix-table td:nth-child(6)::before { content: var(--label-6) ": "; font-weight: 600; }

  table.timeline-table {
    --tlabel-2: "Timestamp";
    --tlabel-3: "Type";
    --tlabel-4: "Agent";
    --tlabel-5: "PROV Inputs / Outputs";
  }

  table.timeline-table td:nth-child(2)::before { content: var(--tlabel-2) ": "; font-weight: 600; }
  table.timeline-table td:nth-child(3)::before { content: var(--tlabel-3) ": "; font-weight: 600; }
  table.timeline-table td:nth-child(4)::before { content: var(--tlabel-4) ": "; font-weight: 600; }
  table.timeline-table td:nth-child(5)::before { content: var(--tlabel-5) ": "; font-weight: 600; }
}

.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.entity-chip {
  font-size: 0.75rem;
  padding-inline: 0.45rem;
  padding-block: 0.14rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-color);
  background: var(--bg-canvas);
  cursor: pointer;
}

.entity-chip:hover {
  border-color: var(--brand);
}

.legend-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-block-end: 0.65rem;
}

.legend-swatch {
  display: inline-block;
  inline-size: 0.75rem;
  block-size: 0.75rem;
  border-radius: 0.2rem;
  vertical-align: middle;
  margin-inline-end: 0.3rem;
}
`;
