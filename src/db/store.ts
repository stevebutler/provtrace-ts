import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  LoaderLogEntry,
  LoaderName,
  LoaderState,
  LoaderStatusRecord,
  ProcessAnomaly,
  ProvActivity,
  ProvAgent,
  ProvEntity,
  ProvGraphEdge,
  ProvGraphNode,
  ProvRelation,
  ProvRelationType,
  RequirementTraceRow,
  SummaryStats,
} from "../prov/types.js";

export const LOADER_DEFINITIONS: Array<{
  loaderName: LoaderName;
  title: string;
  description: string;
}> = [
  {
    loaderName: "git-commits",
    title: "Git Repository Extractor",
    description: "Extracts commits, file revisions, commit activities, and author agents from target-project.",
  },
  {
    loaderName: "asciidoc-specs",
    title: "AsciiDoc Specification Extractor",
    description: "Parses docs/*.adoc requirement blocks (REQ-*) and links them to Git document revisions.",
  },
  {
    loaderName: "github-issues",
    title: "GitHub Issues & PRs Extractor",
    description: "Loads Issues, Bugs, Pull Requests, review activities, and GitHub agents from JSON fixtures.",
  },
  {
    loaderName: "prov-linker",
    title: "W3C PROV Cross-Source Linker",
    description: "Connects Issues, Requirements, PRs, Commits, Code, and Tests via wasDerivedFrom & used.",
  },
];

export class ProvStore {
  readonly db: DatabaseSync;

  constructor(dbPath = path.resolve(process.cwd(), "data/provtrace.db")) {
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prov_entities (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT,
        attributes_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS prov_activities (
        id TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        attributes_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS prov_agents (
        id TEXT PRIMARY KEY,
        agent_type TEXT NOT NULL,
        label TEXT NOT NULL,
        attributes_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS prov_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relation_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        object_id TEXT NOT NULL,
        role TEXT,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(relation_type, subject_id, object_id)
      );

      CREATE TABLE IF NOT EXISTS loader_status (
        loader_name TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        progress_pct INTEGER NOT NULL DEFAULT 0,
        items_processed INTEGER NOT NULL DEFAULT 0,
        relations_created INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        message TEXT NOT NULL DEFAULT 'Ready to extract',
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS loader_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        loader_name TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      );
    `);

    const stmt = this.db.prepare(`
      INSERT INTO loader_status (loader_name, title, description)
      VALUES (?, ?, ?)
      ON CONFLICT(loader_name) DO UPDATE SET
        title = excluded.title,
        description = excluded.description
    `);
    for (const def of LOADER_DEFINITIONS) {
      stmt.run(def.loaderName, def.title, def.description);
    }
  }

  resetAllData() {
    this.db.exec(`
      DELETE FROM prov_relations;
      DELETE FROM prov_entities;
      DELETE FROM prov_activities;
      DELETE FROM prov_agents;
      DELETE FROM loader_logs;
      UPDATE loader_status SET
        status = 'idle',
        progress_pct = 0,
        items_processed = 0,
        relations_created = 0,
        started_at = NULL,
        finished_at = NULL,
        message = 'Ready to extract',
        error = NULL;
    `);
  }

  upsertEntity(entity: ProvEntity) {
    this.db
      .prepare(
        `INSERT INTO prov_entities (id, entity_type, label, source, created_at, attributes_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           entity_type = excluded.entity_type,
           label = excluded.label,
           source = excluded.source,
           created_at = excluded.created_at,
           attributes_json = excluded.attributes_json`
      )
      .run(
        entity.id,
        entity.entityType,
        entity.label,
        entity.source,
        entity.createdAt,
        JSON.stringify(entity.attributes)
      );
  }

  upsertActivity(activity: ProvActivity) {
    this.db
      .prepare(
        `INSERT INTO prov_activities (id, activity_type, label, source, started_at, ended_at, attributes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           activity_type = excluded.activity_type,
           label = excluded.label,
           source = excluded.source,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           attributes_json = excluded.attributes_json`
      )
      .run(
        activity.id,
        activity.activityType,
        activity.label,
        activity.source,
        activity.startedAt,
        activity.endedAt,
        JSON.stringify(activity.attributes)
      );
  }

  upsertAgent(agent: ProvAgent) {
    this.db
      .prepare(
        `INSERT INTO prov_agents (id, agent_type, label, attributes_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           agent_type = excluded.agent_type,
           label = excluded.label,
           attributes_json = excluded.attributes_json`
      )
      .run(agent.id, agent.agentType, agent.label, JSON.stringify(agent.attributes));
  }

  addRelation(rel: ProvRelation): boolean {
    const res = this.db
      .prepare(
        `INSERT INTO prov_relations (relation_type, subject_id, object_id, role, attributes_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(relation_type, subject_id, object_id) DO UPDATE SET
           role = excluded.role,
           attributes_json = excluded.attributes_json`
      )
      .run(
        rel.relationType,
        rel.subjectId,
        rel.objectId,
        rel.role ?? null,
        JSON.stringify(rel.attributes ?? {})
      );
    return Number(res.changes) > 0;
  }

  updateLoaderStatus(
    loaderName: LoaderName,
    patch: Partial<{
      status: LoaderState;
      progressPct: number;
      itemsProcessed: number;
      relationsCreated: number;
      startedAt: string | null;
      finishedAt: string | null;
      message: string;
      error: string | null;
    }>
  ) {
    const current = this.getLoaderStatuses().find((s) => s.loaderName === loaderName);
    if (!current) return;
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE loader_status SET
           status = ?,
           progress_pct = ?,
           items_processed = ?,
           relations_created = ?,
           started_at = ?,
           finished_at = ?,
           message = ?,
           error = ?
         WHERE loader_name = ?`
      )
      .run(
        next.status,
        next.progressPct,
        next.itemsProcessed,
        next.relationsCreated,
        next.startedAt,
        next.finishedAt,
        next.message,
        next.error,
        loaderName
      );
  }

  appendLog(loaderName: string, level: "info" | "warn" | "error", message: string) {
    this.db
      .prepare(
        `INSERT INTO loader_logs (timestamp, loader_name, level, message)
         VALUES (?, ?, ?, ?)`
      )
      .run(new Date().toISOString(), loaderName, level, message);
  }

  getLoaderStatuses(): LoaderStatusRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM loader_status ORDER BY rowid ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      loaderName: r.loader_name as LoaderName,
      title: String(r.title),
      description: String(r.description),
      status: r.status as LoaderState,
      progressPct: Number(r.progress_pct),
      itemsProcessed: Number(r.items_processed),
      relationsCreated: Number(r.relations_created),
      startedAt: (r.started_at as string | null) ?? null,
      finishedAt: (r.finished_at as string | null) ?? null,
      message: String(r.message),
      error: (r.error as string | null) ?? null,
    }));
  }

  getRecentLogs(limit = 25): LoaderLogEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM loader_logs ORDER BY id DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      timestamp: String(r.timestamp),
      loaderName: String(r.loader_name),
      level: r.level as "info" | "warn" | "error",
      message: String(r.message),
    }));
  }

  getEntities(entityType?: string): ProvEntity[] {
    const rows = entityType
      ? (this.db
          .prepare(`SELECT * FROM prov_entities WHERE entity_type = ? ORDER BY created_at ASC, id ASC`)
          .all(entityType) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(`SELECT * FROM prov_entities ORDER BY created_at ASC, id ASC`)
          .all() as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapEntityRow(r));
  }

  getEntityById(id: string): ProvEntity | null {
    const row = this.db.prepare(`SELECT * FROM prov_entities WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapEntityRow(row) : null;
  }

  getActivities(): ProvActivity[] {
    const rows = this.db
      .prepare(`SELECT * FROM prov_activities ORDER BY started_at ASC, id ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapActivityRow(r));
  }

  getActivityById(id: string): ProvActivity | null {
    const row = this.db.prepare(`SELECT * FROM prov_activities WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapActivityRow(row) : null;
  }

  getAgents(): ProvAgent[] {
    const rows = this.db
      .prepare(`SELECT * FROM prov_agents ORDER BY id ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapAgentRow(r));
  }

  getAgentById(id: string): ProvAgent | null {
    const row = this.db.prepare(`SELECT * FROM prov_agents WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapAgentRow(row) : null;
  }

  getRelations(): ProvRelation[] {
    const rows = this.db
      .prepare(`SELECT * FROM prov_relations ORDER BY id ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      relationType: r.relation_type as ProvRelationType,
      subjectId: String(r.subject_id),
      objectId: String(r.object_id),
      role: (r.role as string | null) ?? null,
      attributes: JSON.parse(String(r.attributes_json || "{}")),
    }));
  }

  getSummaryStats(): SummaryStats {
    const count = (table: string) =>
      Number(
        (this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
      );

    const matrix = this.getRequirementsMatrix();
    const requirementsTotal = matrix.length;
    const requirementsImplemented = matrix.filter((r) => r.compliance !== "unimplemented").length;
    const requirementsVerified = matrix.filter((r) => r.compliance === "verified").length;

    const commits = this.getEntities("Commit");
    const relations = this.getRelations();
    const tracedCommitIds = new Set(
      relations
        .filter(
          (rel) =>
            rel.relationType === "wasDerivedFrom" &&
            rel.subjectId.startsWith("entity:commit:") &&
            (rel.objectId.startsWith("entity:issue:") || rel.objectId.startsWith("entity:req:"))
        )
        .map((rel) => rel.subjectId)
    );
    const tracedCommitsPct =
      commits.length > 0 ? Math.round((tracedCommitIds.size / commits.length) * 100) : 0;

    const issues = [
      ...this.getEntities("Issue"),
      ...this.getEntities("Bug"),
    ];
    const leadHours: number[] = [];
    for (const issue of issues) {
      const closedAt = issue.attributes.closed_at as string | null | undefined;
      if (issue.createdAt && closedAt) {
        const diffMs = new Date(closedAt).getTime() - new Date(issue.createdAt).getTime();
        if (diffMs > 0) {
          leadHours.push(diffMs / (1000 * 60 * 60));
        }
      }
    }
    const avgIssueLeadTimeHours =
      leadHours.length > 0
        ? Math.round((leadHours.reduce((a, b) => a + b, 0) / leadHours.length) * 10) / 10
        : null;

    return {
      entities: count("prov_entities"),
      activities: count("prov_activities"),
      agents: count("prov_agents"),
      relations: count("prov_relations"),
      requirementsTotal,
      requirementsImplemented,
      requirementsVerified,
      tracedCommitsPct,
      avgIssueLeadTimeHours,
    };
  }

  getRequirementsMatrix(): RequirementTraceRow[] {
    const requirements = this.getEntities("Requirement");
    const allEntities = new Map(this.getEntities().map((e) => [e.id, e]));
    const derivedRels = this.getRelations().filter((r) => r.relationType === "wasDerivedFrom");

    // Build reverse derivation adjacency: objectId <- subjectId (things derived FROM objectId)
    const derivedFromObject = new Map<string, Set<string>>();
    // And forward derivation: subjectId -> objectId (things subjectId was derived FROM)
    const derivedTargets = new Map<string, Set<string>>();

    for (const rel of derivedRels) {
      if (!derivedFromObject.has(rel.objectId)) derivedFromObject.set(rel.objectId, new Set());
      derivedFromObject.get(rel.objectId)!.add(rel.subjectId);

      if (!derivedTargets.has(rel.subjectId)) derivedTargets.set(rel.subjectId, new Set());
      derivedTargets.get(rel.subjectId)!.add(rel.objectId);
    }

    return requirements.map((req) => {
      const downstream = new Set<string>();
      const queue = [req.id];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const child of derivedFromObject.get(cur) ?? []) {
          if (!downstream.has(child)) {
            downstream.add(child);
            queue.push(child);
          }
        }
      }

      // Issues can be upstream of REQ (REQ derivedFrom Issue) OR downstream (Issue references REQ)
      const linkedIssueIds = new Set<string>();
      for (const up of derivedTargets.get(req.id) ?? []) {
        if (up.startsWith("entity:issue:")) linkedIssueIds.add(up);
      }
      for (const down of downstream) {
        if (down.startsWith("entity:issue:")) linkedIssueIds.add(down);
      }

      // Also include PRs derived from commits/issues linked to this requirement
      const commits: ProvEntity[] = [];
      const codeFiles: ProvEntity[] = [];
      const testFiles: ProvEntity[] = [];
      const pullRequestIds = new Set<string>();

      for (const id of downstream) {
        const ent = allEntities.get(id);
        if (!ent) continue;
        if (ent.entityType === "Commit") commits.push(ent);
        if (ent.entityType === "CodeArtifact") codeFiles.push(ent);
        if (ent.entityType === "TestArtifact") testFiles.push(ent);
        if (ent.entityType === "PullRequest") pullRequestIds.add(ent.id);
      }

      for (const issueId of linkedIssueIds) {
        for (const child of derivedFromObject.get(issueId) ?? []) {
          const ent = allEntities.get(child);
          if (ent?.entityType === "PullRequest") pullRequestIds.add(ent.id);
        }
      }

      const issues = [...linkedIssueIds]
        .map((id) => allEntities.get(id))
        .filter((e): e is ProvEntity => Boolean(e));
      const pullRequests = [...pullRequestIds]
        .map((id) => allEntities.get(id))
        .filter((e): e is ProvEntity => Boolean(e));

      let compliance: "verified" | "untested" | "unimplemented" = "unimplemented";
      if (codeFiles.length > 0 && testFiles.length > 0) {
        compliance = "verified";
      } else if (codeFiles.length > 0) {
        compliance = "untested";
      }

      return {
        reqId: req.id,
        code: String(req.attributes.code ?? req.id.replace("entity:req:", "")),
        title: String(req.attributes.title ?? req.label),
        specStatus: String(req.attributes.status ?? "Draft"),
        issues,
        pullRequests,
        commits,
        codeFiles,
        testFiles,
        compliance,
      };
    });
  }

  getProcessAnomalies(): ProcessAnomaly[] {
    const anomalies: ProcessAnomaly[] = [];
    const relations = this.getRelations();
    const entities = new Map(this.getEntities().map((e) => [e.id, e]));

    // 1. Untracked commits touching production code without Issue or Requirement derivation
    const commits = this.getEntities("Commit");
    for (const commit of commits) {
      const files = (commit.attributes.files as string[] | undefined) ?? [];
      const touchesSrc = files.some((f) => f.startsWith("src/") && !f.endsWith("__init__.py"));
      if (!touchesSrc) continue;

      const hasGovernanceLink = relations.some(
        (r) =>
          r.relationType === "wasDerivedFrom" &&
          r.subjectId === commit.id &&
          (r.objectId.startsWith("entity:issue:") || r.objectId.startsWith("entity:req:"))
      );

      if (!hasGovernanceLink) {
        anomalies.push({
          severity: "high",
          category: "Untracked Work",
          entityId: commit.id,
          label: commit.label,
          detail: `Modifies production source (${files.join(", ")}) with no prov:wasDerivedFrom link to any GitHub Issue or AsciiDoc Requirement.`,
        });
      }
    }

    // 2. Unimplemented or untested requirements
    for (const row of this.getRequirementsMatrix()) {
      if (row.compliance === "unimplemented") {
        anomalies.push({
          severity: "medium",
          category: "Unimplemented Spec",
          entityId: row.reqId,
          label: `${row.code}: ${row.title}`,
          detail: `Defined in AsciiDoc (${row.specStatus}) with ${row.issues.length} linked issue(s), but zero derived CodeArtifact entities exist.`,
        });
      } else if (row.compliance === "untested") {
        const fileNames = row.codeFiles.map((f) => String(f.attributes.path ?? f.label)).join(", ");
        anomalies.push({
          severity: "medium",
          category: "Missing Test Coverage",
          entityId: row.reqId,
          label: `${row.code}: ${row.title}`,
          detail: `Implemented in ${fileNames}, but no TestArtifact derives from this requirement or its commits.`,
        });
      }
    }

    // Suppress unused warning if entities map is helpful later
    void entities;
    return anomalies;
  }

  getActivityTimeline() {
    const activities = this.getActivities();
    const relations = this.getRelations();
    const agents = new Map(this.getAgents().map((a) => [a.id, a]));
    const entities = new Map(this.getEntities().map((e) => [e.id, e]));

    return activities
      .map((act) => {
        const assocRel = relations.find(
          (r) => r.relationType === "wasAssociatedWith" && r.subjectId === act.id
        );
        const agent = assocRel ? agents.get(assocRel.objectId) ?? null : null;

        const usedEntities = relations
          .filter((r) => r.relationType === "used" && r.subjectId === act.id)
          .map((r) => entities.get(r.objectId))
          .filter((e): e is ProvEntity => Boolean(e));

        const generatedEntities = relations
          .filter((r) => r.relationType === "wasGeneratedBy" && r.objectId === act.id)
          .map((r) => entities.get(r.subjectId))
          .filter((e): e is ProvEntity => Boolean(e));

        return {
          activity: act,
          agent,
          usedEntities,
          generatedEntities,
        };
      })
      .sort((a, b) => {
        const ta = a.activity.startedAt ?? a.activity.endedAt ?? "";
        const tb = b.activity.startedAt ?? b.activity.endedAt ?? "";
        return ta.localeCompare(tb);
      });
  }

  getGraphData(focusId?: string): { nodes: ProvGraphNode[]; edges: ProvGraphEdge[] } {
    const allNodes = new Map<string, ProvGraphNode>();

    for (const e of this.getEntities()) {
      allNodes.set(e.id, {
        id: e.id,
        kind: "entity",
        subType: e.entityType,
        label: e.label,
        shortId: e.id.replace(/^entity:[^:]+:/, ""),
      });
    }
    for (const act of this.getActivities()) {
      allNodes.set(act.id, {
        id: act.id,
        kind: "activity",
        subType: act.activityType,
        label: act.label,
        shortId: act.id.replace(/^activity:[^:]+:/, ""),
      });
    }
    for (const ag of this.getAgents()) {
      allNodes.set(ag.id, {
        id: ag.id,
        kind: "agent",
        subType: ag.agentType,
        label: ag.label,
        shortId: ag.id.replace(/^agent:[^:]+:/, ""),
      });
    }

    // For visual clarity in overview mode, focus on core artifact lineage (Entities + Activities/Agents when focused)
    const allRelations = this.getRelations();

    if (focusId && allNodes.has(focusId)) {
      const keep = new Set<string>([focusId]);
      // Traverse 2 hops undirected around focusId
      let frontier = new Set<string>([focusId]);
      for (let hop = 0; hop < 2; hop++) {
        const next = new Set<string>();
        for (const rel of allRelations) {
          if (frontier.has(rel.subjectId) && allNodes.has(rel.objectId)) {
            if (!keep.has(rel.objectId)) {
              keep.add(rel.objectId);
              next.add(rel.objectId);
            }
          }
          if (frontier.has(rel.objectId) && allNodes.has(rel.subjectId)) {
            if (!keep.has(rel.subjectId)) {
              keep.add(rel.subjectId);
              next.add(rel.subjectId);
            }
          }
        }
        frontier = next;
      }

      const nodes = [...keep].map((id) => allNodes.get(id)!).filter(Boolean);
      const edges = allRelations
        .filter((r) => keep.has(r.subjectId) && keep.has(r.objectId))
        .map((r) => ({
          relationType: r.relationType,
          from: r.subjectId,
          to: r.objectId,
          role: r.role,
        }));
      return { nodes, edges };
    }

    // Overview graph: show Entities connected by wasDerivedFrom so the end-to-end artifact lineage is crisp
    const entityNodes = [...allNodes.values()].filter((n) => n.kind === "entity");
    const entitySet = new Set(entityNodes.map((n) => n.id));
    const edges = allRelations
      .filter(
        (r) =>
          r.relationType === "wasDerivedFrom" &&
          entitySet.has(r.subjectId) &&
          entitySet.has(r.objectId)
      )
      .map((r) => ({
        relationType: r.relationType,
        from: r.subjectId,
        to: r.objectId,
        role: r.role,
      }));

    return { nodes: entityNodes, edges };
  }

  inspectNode(id: string) {
    const entity = this.getEntityById(id);
    const activity = !entity ? this.getActivityById(id) : null;
    const agent = !entity && !activity ? this.getAgentById(id) : null;

    if (!entity && !activity && !agent) return null;

    const relations = this.getRelations();
    const outgoing = relations.filter((r) => r.subjectId === id);
    const incoming = relations.filter((r) => r.objectId === id);

    const resolveLabel = (targetId: string) =>
      this.getEntityById(targetId)?.label ??
      this.getActivityById(targetId)?.label ??
      this.getAgentById(targetId)?.label ??
      targetId;

    return {
      id,
      kind: entity ? ("entity" as const) : activity ? ("activity" as const) : ("agent" as const),
      record: entity ?? activity ?? agent!,
      outgoing: outgoing.map((r) => ({ ...r, targetLabel: resolveLabel(r.objectId) })),
      incoming: incoming.map((r) => ({ ...r, sourceLabel: resolveLabel(r.subjectId) })),
    };
  }

  exportProvJson() {
    const entity: Record<string, unknown> = {};
    for (const e of this.getEntities()) {
      entity[e.id] = {
        "prov:type": `provtrace:${e.entityType}`,
        "prov:label": e.label,
        "provtrace:source": e.source,
        ...(e.createdAt ? { "provtrace:createdAt": e.createdAt } : {}),
        ...e.attributes,
      };
    }

    const activity: Record<string, unknown> = {};
    for (const a of this.getActivities()) {
      activity[a.id] = {
        "prov:type": `provtrace:${a.activityType}`,
        "prov:label": a.label,
        ...(a.startedAt ? { "prov:startTime": a.startedAt } : {}),
        ...(a.endedAt ? { "prov:endTime": a.endedAt } : {}),
        ...a.attributes,
      };
    }

    const agent: Record<string, unknown> = {};
    for (const ag of this.getAgents()) {
      agent[ag.id] = {
        "prov:type": `prov:${ag.agentType}`,
        "prov:label": ag.label,
        ...ag.attributes,
      };
    }

    const grouped: Record<string, Record<string, unknown>> = {
      wasDerivedFrom: {},
      wasGeneratedBy: {},
      used: {},
      wasAttributedTo: {},
      wasAssociatedWith: {},
      wasInformedBy: {},
      actedOnBehalfOf: {},
    };

    for (const rel of this.getRelations()) {
      const key = `_:r${rel.id}`;
      switch (rel.relationType) {
        case "wasDerivedFrom":
          grouped.wasDerivedFrom[key] = {
            "prov:generatedEntity": rel.subjectId,
            "prov:usedEntity": rel.objectId,
            ...(rel.role ? { "prov:type": rel.role } : {}),
          };
          break;
        case "wasGeneratedBy":
          grouped.wasGeneratedBy[key] = {
            "prov:entity": rel.subjectId,
            "prov:activity": rel.objectId,
          };
          break;
        case "used":
          grouped.used[key] = {
            "prov:activity": rel.subjectId,
            "prov:entity": rel.objectId,
          };
          break;
        case "wasAttributedTo":
          grouped.wasAttributedTo[key] = {
            "prov:entity": rel.subjectId,
            "prov:agent": rel.objectId,
          };
          break;
        case "wasAssociatedWith":
          grouped.wasAssociatedWith[key] = {
            "prov:activity": rel.subjectId,
            "prov:agent": rel.objectId,
          };
          break;
        case "wasInformedBy":
          grouped.wasInformedBy[key] = {
            "prov:informed": rel.subjectId,
            "prov:informant": rel.objectId,
          };
          break;
        case "actedOnBehalfOf":
          grouped.actedOnBehalfOf[key] = {
            "prov:delegate": rel.subjectId,
            "prov:responsible": rel.objectId,
          };
          break;
      }
    }

    return {
      prefix: {
        prov: "http://www.w3.org/ns/prov#",
        provtrace: "https://provtrace.example.org/ns#",
      },
      entity,
      activity,
      agent,
      ...grouped,
    };
  }

  private mapEntityRow(r: Record<string, unknown>): ProvEntity {
    return {
      id: String(r.id),
      entityType: r.entity_type as ProvEntity["entityType"],
      label: String(r.label),
      source: r.source as ProvEntity["source"],
      createdAt: (r.created_at as string | null) ?? null,
      attributes: JSON.parse(String(r.attributes_json || "{}")),
    };
  }

  private mapActivityRow(r: Record<string, unknown>): ProvActivity {
    return {
      id: String(r.id),
      activityType: r.activity_type as ProvActivity["activityType"],
      label: String(r.label),
      source: r.source as ProvActivity["source"],
      startedAt: (r.started_at as string | null) ?? null,
      endedAt: (r.ended_at as string | null) ?? null,
      attributes: JSON.parse(String(r.attributes_json || "{}")),
    };
  }

  private mapAgentRow(r: Record<string, unknown>): ProvAgent {
    return {
      id: String(r.id),
      agentType: r.agent_type as ProvAgent["agentType"],
      label: String(r.label),
      attributes: JSON.parse(String(r.attributes_json || "{}")),
    };
  }
}
