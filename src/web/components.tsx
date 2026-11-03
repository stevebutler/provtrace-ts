import type { FC } from "hono/jsx";
import type { ProvStore } from "../db/store.js";
import { computeProvGraphLayout } from "./graph-layout.js";
import { APP_CSS } from "./styles.js";

const dsClick = (expr: string) => ({ "data-on:click": expr } as Record<string, string>);
const dsInit = (expr: string) => ({ "data-init": expr } as Record<string, string>);

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str;
}

function edgeColor(relType: string): string {
  switch (relType) {
    case "wasDerivedFrom":
      return "#2563eb";
    case "wasRevisionOf":
      return "#0891b2";
    case "hadMember":
      return "#ca8a04";
    case "wasGeneratedBy":
      return "#16a34a";
    case "wasInvalidatedBy":
      return "#dc2626";
    case "used":
      return "#9333ea";
    case "wasAttributedTo":
    case "wasAssociatedWith":
    case "actedOnBehalfOf":
      return "#ea580c";
    default:
      return "#64748b";
  }
}

export const KpiSection: FC<{ store: ProvStore }> = ({ store }) => {
  const stats = store.getSummaryStats();
  return (
    <section id="kpi-section" class="kpi-section">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">prov:Entity</div>
          <div class="kpi-value">{stats.entities}</div>
          <div class="kpi-meta">Issues, Specs, PRs, Code &amp; Test Files</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">prov:Activity</div>
          <div class="kpi-value">{stats.activities}</div>
          <div class="kpi-meta">Git Commits, Issue &amp; PR Events</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">prov:Agent</div>
          <div class="kpi-value">{stats.agents}</div>
          <div class="kpi-meta">Git Authors &amp; GitHub Identities</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">PROV Relations</div>
          <div class="kpi-value">{stats.relations}</div>
          <div class="kpi-meta">wasDerivedFrom, used, wasGeneratedBy</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Spec Compliance</div>
          <div class="kpi-value">
            {stats.requirementsCompliant}/{stats.requirementsTotal}
          </div>
          <div class="kpi-meta">
            {stats.requirementsImplemented} implemented, {stats.requirementsCompliant} passing rules
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Commit Governance</div>
          <div class="kpi-value">{stats.tracedCommitsPct}%</div>
          <div class="kpi-meta">
            Avg Issue Lead:{" "}
            {stats.avgIssueLeadTimeHours !== null ? `${stats.avgIssueLeadTimeHours}h` : "—"}
          </div>
        </div>
      </div>
    </section>
  );
};

export const LoadersSection: FC<{ store: ProvStore; isRunning: boolean }> = ({
  store,
  isRunning,
}) => {
  const loaders = store.getLoaderStatuses();
  const logs = store.getRecentLogs(18);

  return (
    <section id="loaders-section" class="loaders-section panel">
      <div class="panel-header">
        <div>
          <h2>Data Extraction &amp; Linking Processes</h2>
          <p>
            Live status of source extractors populating the SQLite W3C PROV store (streamed via
            Datastar SSE)
          </p>
        </div>
        <div class="panel-actions">
          <button
            type="button"
            class="primary"
            disabled={isRunning}
            {...dsClick("@post('/api/loaders/run-all')")}
          >
            {isRunning ? "Pipeline Running…" : "▶ Run Full Pipeline"}
          </button>
          <button
            type="button"
            disabled={isRunning}
            {...dsClick("@post('/api/loaders/reset')")}
          >
            Reset Store
          </button>
        </div>
      </div>

      <div class="loaders-layout">
        <div class="loader-cards">
          {loaders.map((l) => (
            <div class="loader-card" key={l.loaderName}>
              <div class="loader-top">
                <span class="loader-title">{l.title}</span>
                <span class={`badge ${l.status}`} style="margin-inline-start: auto;">
                  {l.status}
                </span>
              </div>
              <div class="progress-track" role="progressbar" aria-valuenow={l.progressPct}>
                <div class="progress-fill" style={`inline-size: ${l.progressPct}%;`} />
              </div>
              <div class="loader-msg">{l.message}</div>
              <div
                style="display: flex; align-items: safe center; gap: 0.5rem; margin-block-start: auto; padding-block-start: 0.25rem;"
              >
                <span style="font-size: 0.75rem; color: var(--text-muted);">
                  Items: <strong>{l.itemsProcessed}</strong> · Links:{" "}
                  <strong>{l.relationsCreated}</strong>
                </span>
                <button
                  type="button"
                  class="small"
                  style="margin-inline-start: auto;"
                  disabled={isRunning}
                  {...dsClick(`@post('/api/loaders/run?loader=${l.loaderName}')`)}
                >
                  Run
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <div style="font-size: 0.82rem; font-weight: 600; margin-block-end: 0.35rem;">
            Live Extraction Event Stream
          </div>
          <div class="log-feed">
            {logs.length === 0 ? (
              <div style="color: var(--text-muted);">No loader events yet. Click "Run Full Pipeline".</div>
            ) : (
              logs.map((entry) => (
                <div class="log-line" key={entry.id}>
                  <span style="color: var(--text-muted); flex-shrink: 0;">
                    {entry.timestamp.slice(11, 19)}
                  </span>
                  <strong style="flex-shrink: 0;">[{entry.loaderName}]</strong>
                  <span>{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export const NodeInspector: FC<{ store: ProvStore; selectedId?: string }> = ({
  store,
  selectedId,
}) => {
  const info = selectedId ? store.inspectNode(selectedId) : null;

  if (!info) {
    return (
      <aside id="node-inspector" class="inspector-box">
        <h3 style="margin-block: 0 0.4rem; font-size: 0.98rem;">W3C PROV Node Inspector</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">
          Click any node in the provenance graph, filter bar, or traceability matrix below to inspect
          its <code>prov:wasDerivedFrom</code>, <code>prov:used</code>,{" "}
          <code>prov:wasGeneratedBy</code>, and <code>prov:wasAttributedTo</code> neighborhood.
        </p>
      </aside>
    );
  }

  return (
    <aside id="node-inspector" class="inspector-box">
      <div style="display: flex; align-items: safe center; gap: 0.45rem; margin-block-end: 0.35rem;">
        <span class="badge neutral">prov:{info.kind}</span>
        <button
          type="button"
          class="small"
          style="margin-inline-start: auto;"
          {...dsClick("@get('/api/focus')")}
        >
          Clear Focus
        </button>
      </div>
      <h3 style="margin-block: 0 0.2rem; font-size: 0.98rem; overflow-wrap: anywhere;">
        {info.record.label}
      </h3>
      <code style="display: block; color: var(--text-muted); margin-block-end: 0.75rem; overflow-wrap: anywhere;">
        {info.id}
      </code>

      <div style="font-size: 0.8rem; font-weight: 650;">
        Outgoing PROV Relations ({info.outgoing.length})
      </div>
      {info.outgoing.length === 0 ? (
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-block: 0.25rem 0.75rem;">
          None (root source artifact or actor).
        </p>
      ) : (
        <ul class="rel-list">
          {info.outgoing.map((r) => (
            <li class="rel-item" key={r.id}>
              <span class="badge neutral">
                {r.relationType}
                {r.role && !r.role.includes(":") ? ` (${r.role})` : ""}
              </span>
              <span>→</span>
              <button
                type="button"
                class="entity-chip"
                {...dsClick(`@get('/api/focus?id=${encodeURIComponent(r.objectId)}')`)}
              >
                {truncate(r.targetLabel, 38)}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style="font-size: 0.8rem; font-weight: 650;">
        Incoming PROV Relations ({info.incoming.length})
      </div>
      {info.incoming.length === 0 ? (
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-block: 0.25rem 0.75rem;">
          No downstream artifacts reference this node yet.
        </p>
      ) : (
        <ul class="rel-list">
          {info.incoming.map((r) => (
            <li class="rel-item" key={r.id}>
              <button
                type="button"
                class="entity-chip"
                {...dsClick(`@get('/api/focus?id=${encodeURIComponent(r.subjectId)}')`)}
              >
                {truncate(r.sourceLabel, 38)}
              </button>
              <span>—</span>
              <span class="badge neutral">
                {r.relationType}
                {r.role && !r.role.includes(":") ? ` (${r.role})` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details style="margin-block-start: 0.6rem;">
        <summary style="cursor: pointer; font-size: 0.8rem; font-weight: 600;">
          Attributes JSON
        </summary>
        <pre
          style="margin-block: 0.4rem 0; padding: 0.55rem; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 0.4rem; overflow-x: auto;"
        >
          {JSON.stringify(info.record.attributes, null, 2)}
        </pre>
      </details>
    </aside>
  );
};

export const ExplorerSection: FC<{ store: ProvStore; focusId?: string }> = ({
  store,
  focusId,
}) => {
  const { nodes, edges } = store.getGraphData(focusId);
  const layout = computeProvGraphLayout(nodes, edges);

  const quickFilters: Array<{ id?: string; label: string }> = [
    { id: undefined, label: "All Artifact Derivations" },
    { id: "entity:req:REQ-001", label: "REQ-001 (Decimal & Bug #3)" },
    { id: "entity:req:REQ-002", label: "REQ-002 (Category Rollups)" },
    { id: "entity:req:REQ-003", label: "REQ-003 (Untested WIP)" },
    { id: "entity:req:REQ-004", label: "REQ-004 (Unimplemented)" },
    { id: "entity:issue:3", label: "Bug #3 Lineage" },
  ];

  return (
    <section id="explorer-section" class="explorer-section panel">
      <div class="panel-header">
        <div>
          <h2>Interactive W3C PROV Lineage Graph</h2>
          <p>
            {focusId
              ? `Showing 2-hop PROV neighborhood (Entities, Activities & Agents) around ${focusId}`
              : "Overview of causal lineage across Issues, AsciiDoc Specs, Commit Activities (prov:Activity), Files & PRs"}
          </p>
        </div>
        <div class="panel-actions">
          <a href="/api/prov.json" target="_blank" rel="noreferrer" class="btn small">
            Export W3C PROV-JSON ↗
          </a>
        </div>
      </div>

      <div class="filter-pills">
        {quickFilters.map((f) => {
          const isActive = (f.id ?? "") === (focusId ?? "");
          const url = f.id ? `/api/focus?id=${encodeURIComponent(f.id)}` : "/api/focus";
          return (
            <button
              type="button"
              key={f.label}
              class={`pill ${isActive ? "active" : ""}`}
              {...dsClick(`@get('${url}')`)}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div class="legend-bar">
        <span>
          <span
            class="legend-swatch"
            style="background: var(--prov-entity-fill); border: 1.5px solid var(--prov-entity-stroke);"
          />
          prov:Entity (Oval/Pill)
        </span>
        <span>
          <span
            class="legend-swatch"
            style="background: var(--prov-activity-fill); border: 1.5px solid var(--prov-activity-stroke);"
          />
          prov:Activity (Rectangle)
        </span>
        <span>
          <span
            class="legend-swatch"
            style="background: var(--prov-agent-fill); border: 1.5px solid var(--prov-agent-stroke);"
          />
          prov:Agent (Pentagon)
        </span>
        <span style="color: #2563eb;">● wasDerivedFrom</span>
        <span style="color: #0891b2;">● wasRevisionOf</span>
        <span style="color: #ca8a04;">● hadMember</span>
        <span style="color: #16a34a;">● wasGeneratedBy</span>
        <span style="color: #dc2626;">● wasInvalidatedBy</span>
        <span style="color: #9333ea;">● used</span>
        <span style="color: #ea580c;">● attribution / agent</span>
      </div>

      <div class="explorer-split">
        <div class="graph-scroll">
          {nodes.length === 0 ? (
            <div style="padding: 2rem; color: var(--text-muted);">
              Graph is empty. Click <strong>Run Full Pipeline</strong> above to extract PROV data.
            </div>
          ) : (
            <svg
              class="prov-svg"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label="W3C PROV software provenance graph"
            >
              <defs>
                {[
                  "wasDerivedFrom",
                  "wasRevisionOf",
                  "hadMember",
                  "wasGeneratedBy",
                  "wasInvalidatedBy",
                  "used",
                  "wasAttributedTo",
                  "other",
                ].map((t) => (
                  <marker
                    key={t}
                    id={`arrow-${t}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill={edgeColor(t)} />
                  </marker>
                ))}
              </defs>

              {layout.columns.map((col) => (
                <g key={col.index}>
                  <text
                    x={col.x + 98}
                    y={26}
                    text-anchor="middle"
                    font-size="11.5"
                    font-weight="700"
                    fill="currentColor"
                    opacity="0.7"
                  >
                    {col.title}
                  </text>
                </g>
              ))}

              {layout.edges.map((e, idx) => {
                const markerKey = [
                  "wasDerivedFrom",
                  "wasRevisionOf",
                  "hadMember",
                  "wasGeneratedBy",
                  "wasInvalidatedBy",
                  "used",
                  "wasAttributedTo",
                ].includes(e.relationType)
                  ? e.relationType
                  : e.relationType === "wasAssociatedWith" || e.relationType === "actedOnBehalfOf"
                    ? "wasAttributedTo"
                    : "other";
                return (
                  <g key={idx}>
                    <path
                      d={e.pathD}
                      fill="none"
                      stroke={edgeColor(e.relationType)}
                      stroke-width="1.65"
                      stroke-dasharray={
                        e.relationType === "wasRevisionOf" || e.relationType === "wasInvalidatedBy"
                          ? "4 3"
                          : undefined
                      }
                      stroke-opacity="0.78"
                      marker-end={`url(#arrow-${markerKey})`}
                    />
                  </g>
                );
              })}

              {layout.nodes.map((node) => {
                const isSelected = node.id === focusId;
                const cx = node.x + node.width / 2;
                const housePoints = `${node.x},${node.y + 14} ${cx},${node.y} ${
                  node.x + node.width
                },${node.y + 14} ${node.x + node.width},${node.y + node.height} ${node.x},${
                  node.y + node.height
                }`;

                return (
                  <g
                    key={node.id}
                    class="prov-node"
                    {...dsClick(`@get('/api/focus?id=${encodeURIComponent(node.id)}')`)}
                  >
                    {node.kind === "agent" ? (
                      <polygon
                        points={housePoints}
                        fill="var(--prov-agent-fill)"
                        stroke={isSelected ? "var(--brand)" : "var(--prov-agent-stroke)"}
                        stroke-width={isSelected ? "3" : "1.5"}
                      />
                    ) : node.kind === "activity" ? (
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.width}
                        height={node.height}
                        rx="3"
                        fill="var(--prov-activity-fill)"
                        stroke={isSelected ? "var(--brand)" : "var(--prov-activity-stroke)"}
                        stroke-width={isSelected ? "3" : "1.5"}
                      />
                    ) : (
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.width}
                        height={node.height}
                        rx="22"
                        fill="var(--prov-entity-fill)"
                        stroke={isSelected ? "var(--brand)" : "var(--prov-entity-stroke)"}
                        stroke-width={isSelected ? "3" : "1.5"}
                      />
                    )}
                    <text
                      x={cx}
                      y={node.y + 19}
                      text-anchor="middle"
                      font-size="10"
                      font-weight="700"
                      fill="currentColor"
                      opacity="0.72"
                    >
                      {node.subType}
                    </text>
                    <text
                      x={cx}
                      y={node.y + 35}
                      text-anchor="middle"
                      font-size="11"
                      font-weight="600"
                      fill="currentColor"
                    >
                      {truncate(node.label, 25)}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <NodeInspector store={store} selectedId={focusId} />
      </div>
    </section>
  );
};

export const ReportsSection: FC<{ store: ProvStore }> = ({ store }) => {
  const matrix = store.getRequirementsMatrix();
  const anomalies = store.getProcessAnomalies();
  const timeline = store.getActivityTimeline();

  return (
    <div id="reports-section" class="reports-section">
      {/* 1. Process Mining Governance & Traceability Findings */}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Process Mining Findings &amp; Governance Gaps ({anomalies.length})</h2>
            <p>
              Automatically detected process deviations across Git commits, AsciiDoc specs, and
              GitHub Issues
            </p>
          </div>
        </div>

        {anomalies.length === 0 ? (
          <p style="color: var(--text-muted); margin: 0;">
            No anomalies detected (or data not extracted yet).
          </p>
        ) : (
          <div class="anomaly-grid">
            {anomalies.map((a) => (
              <div class="anomaly-card" key={`${a.ruleId}-${a.nodeId}`}>
                <div style="display: flex; align-items: safe center; gap: 0.45rem; margin-block-end: 0.35rem;">
                  <span class={`badge ${a.severity}`}>{a.category}</span>
                  <code style="font-size: 0.74rem; color: var(--text-muted);">{a.ruleId}</code>
                  <button
                    type="button"
                    class="small"
                    style="margin-inline-start: auto;"
                    {...dsClick(`@get('/api/focus?id=${encodeURIComponent(a.nodeId)}')`)}
                  >
                    Inspect Graph
                  </button>
                </div>
                <div style="font-weight: 650; font-size: 0.9rem; margin-block-end: 0.25rem;">
                  {a.label}
                </div>
                <div style="font-size: 0.82rem; color: var(--text-muted);">{a.detail}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Requirements Traceability Matrix */}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>End-to-End Requirements Traceability Matrix</h2>
            <p>
              Transitive <code>prov:wasDerivedFrom</code> closure from AsciiDoc specification
              sections to code &amp; tests
            </p>
          </div>
        </div>

        <div
          tabindex={0}
          role="region"
          aria-labelledby="matrix-table-caption"
          class="table-wrapper"
        >
          <table class="data-table matrix-table">
            <caption id="matrix-table-caption">
              AsciiDoc requirement derivation coverage across GitHub Issues, PRs, Commits, and
              Python artifacts
            </caption>
            <thead>
              <tr>
                <th scope="col">Requirement</th>
                <th scope="col">Compliance</th>
                <th scope="col">GitHub Issues</th>
                <th scope="col">Pull Requests</th>
                <th scope="col">Commit Activities</th>
                <th scope="col">Python Code &amp; Tests</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.reqId}>
                  <th scope="row">
                    <button
                      type="button"
                      class="entity-chip"
                      style="font-weight: 700;"
                      {...dsClick(`@get('/api/focus?id=${encodeURIComponent(row.reqId)}')`)}
                    >
                      {row.code}
                    </button>
                    <div style="font-weight: 500; margin-block-start: 0.2rem;">{row.title}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">
                      Spec status: {row.specStatus}
                    </div>
                  </th>
                  <td>
                    {row.compliant ? (
                      <span class="badge ok">Compliant</span>
                    ) : (
                      <div class="chip-group">
                        {row.findings.map((f) => (
                          <span
                            key={f.ruleId}
                            class={`badge ${f.severity}`}
                            title={f.detail}
                          >
                            {f.ruleId}: {f.category}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <div class="chip-group">
                      {row.issues.length === 0 ? (
                        <span style="color: var(--text-muted);">—</span>
                      ) : (
                        row.issues.map((iss) => (
                          <button
                            type="button"
                            key={iss.id}
                            class="entity-chip"
                            {...dsClick(`@get('/api/focus?id=${encodeURIComponent(iss.id)}')`)}
                          >
                            #{String(iss.attributes.number)} ({String(iss.attributes.state)})
                          </button>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <div class="chip-group">
                      {row.pullRequests.length === 0 ? (
                        <span style="color: var(--text-muted);">—</span>
                      ) : (
                        row.pullRequests.map((pr) => (
                          <button
                            type="button"
                            key={pr.id}
                            class="entity-chip"
                            {...dsClick(`@get('/api/focus?id=${encodeURIComponent(pr.id)}')`)}
                          >
                            PR #{String(pr.attributes.number)} ({String(pr.attributes.state)})
                          </button>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <div class="chip-group">
                      {row.commitActivities.length === 0 ? (
                        <span style="color: var(--text-muted);">—</span>
                      ) : (
                        row.commitActivities.map((c) => (
                          <button
                            type="button"
                            key={c.id}
                            class="entity-chip"
                            {...dsClick(`@get('/api/focus?id=${encodeURIComponent(c.id)}')`)}
                          >
                            ⚡ {String(c.attributes.shortSha)}
                          </button>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <div class="chip-group">
                      {[...row.codeFiles, ...row.testFiles].length === 0 ? (
                        <span style="color: var(--text-muted);">None</span>
                      ) : (
                        [...row.codeFiles, ...row.testFiles].map((f) => (
                          <button
                            type="button"
                            key={f.id}
                            class="entity-chip"
                            {...dsClick(`@get('/api/focus?id=${encodeURIComponent(f.id)}')`)}
                          >
                            {f.entityType === "TestArtifact" ? "🧪 " : "🐍 "}
                            {String(f.attributes.path)}@{String(f.attributes.shortSha)}
                          </button>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Process Mining Event Log (prov:Activity Stream) */}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Development Process Event Log (prov:Activity Timeline)</h2>
            <p>
              Chronological software engineering events reconstructed across GitHub Issues, PR
              reviews, and Git commits
            </p>
          </div>
        </div>

        <div
          tabindex={0}
          role="region"
          aria-labelledby="timeline-table-caption"
          class="table-wrapper"
        >
          <table class="data-table timeline-table">
            <caption id="timeline-table-caption">
              Chronological W3C PROV activities with associated agents, used inputs, and generated
              entities
            </caption>
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col">Timestamp</th>
                <th scope="col">Type</th>
                <th scope="col">Agent (wasAssociatedWith)</th>
                <th scope="col">Inputs (used), Outputs (gen) &amp; Invalidations (inv)</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map(
                ({
                  activity,
                  associations,
                  usedEntities,
                  generatedEntities,
                  invalidatedEntities,
                }) => (
                  <tr key={activity.id}>
                    <th scope="row">
                      <button
                        type="button"
                        class="entity-chip"
                        {...dsClick(`@get('/api/focus?id=${encodeURIComponent(activity.id)}')`)}
                      >
                        {truncate(activity.label, 42)}
                      </button>
                    </th>
                    <td style="white-space: nowrap; color: var(--text-muted);">
                      {(activity.endedAt ?? activity.startedAt ?? "").replace("T", " ").slice(0, 16)}
                    </td>
                    <td>
                      <span class="badge neutral">{activity.activityType}</span>
                    </td>
                    <td>
                      {associations.length === 0 ? (
                        "—"
                      ) : (
                        <div class="chip-group">
                          {associations.map((assoc) => (
                            <button
                              type="button"
                              key={`${assoc.agent.id}-${assoc.role ?? ""}`}
                              class="entity-chip"
                              {...dsClick(
                                `@get('/api/focus?id=${encodeURIComponent(assoc.agent.id)}')`
                              )}
                            >
                              {truncate(assoc.agent.label, 22)}
                              {assoc.role ? ` (${assoc.role})` : ""}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <div class="chip-group">
                        {usedEntities.slice(0, 3).map((u) => (
                          <span class="entity-chip" key={`u-${u.id}`}>
                            used: {truncate(u.label, 24)}
                          </span>
                        ))}
                        {generatedEntities.slice(0, 3).map((g) => (
                          <span class="entity-chip" key={`g-${g.id}`}>
                            gen: {truncate(g.label, 24)}
                          </span>
                        ))}
                        {invalidatedEntities.slice(0, 3).map((inv) => (
                          <span class="entity-chip" key={`inv-${inv.id}`}>
                            inv: {truncate(inv.label, 24)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export const AppPage: FC<{
  store: ProvStore;
  isRunning: boolean;
  focusId?: string;
}> = ({ store, isRunning, focusId }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>ProvTrace — Software Process Mining with W3C PROV</title>
        <style dangerouslySetInnerHTML={{ __html: APP_CSS }} />
        <script type="module" src="/public/datastar.js" />
      </head>
      <body>
        <main class="app-shell" {...dsInit("@get('/api/stream')")}>
          <header class="app-header">
            <div>
              <h1 class="app-title">ProvTrace · Provenance Tracer</h1>
              <p class="app-subtitle">
                Process mining prototype for <code>acme/pyledger</code> (Python + AsciiDoc in Git +
                GitHub Issues) modeled with W3C PROV
              </p>
            </div>
            <div class="header-actions">
              <span class="badge ok">SQLite + Hono JSX + Datastar</span>
            </div>
          </header>

          <KpiSection store={store} />
          <LoadersSection store={store} isRunning={isRunning} />
          <ExplorerSection store={store} focusId={focusId} />
          <ReportsSection store={store} />
        </main>
      </body>
    </html>
  );
};
