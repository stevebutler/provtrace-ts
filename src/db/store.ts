import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { evaluateGovernanceRules, type GovernanceRule } from "../prov/governance.js";
import type {
  GraphFocusMode,
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
  RequirementTrace,
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
    description:
      "Extracts commit activities (prov:Activity), file revisions (prov:Entity), and Git author agents.",
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
    description: "Connects Issues, Requirements, Commit Activities, PRs, Code, and Tests via PROV relations.",
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
        role TEXT NOT NULL DEFAULT '',
        attributes_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(relation_type, subject_id, object_id, role)
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

    // Upgrade existing SQLite prov_relations schema if created before qualified-role uniqueness
    const relTableMeta = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'prov_relations'`)
      .get() as { sql?: string } | undefined;
    if (relTableMeta?.sql && !relTableMeta.sql.includes("subject_id, object_id, role")) {
      this.db.exec(`
        ALTER TABLE prov_relations RENAME TO prov_relations_legacy;
        CREATE TABLE prov_relations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          relation_type TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          object_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT '',
          attributes_json TEXT NOT NULL DEFAULT '{}',
          UNIQUE(relation_type, subject_id, object_id, role)
        );
        INSERT OR IGNORE INTO prov_relations (id, relation_type, subject_id, object_id, role, attributes_json)
          SELECT id, relation_type, subject_id, object_id, COALESCE(role, ''), attributes_json
          FROM prov_relations_legacy;
        DROP TABLE prov_relations_legacy;
      `);
    }

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
         ON CONFLICT(relation_type, subject_id, object_id, role) DO UPDATE SET
           attributes_json = excluded.attributes_json`
      )
      .run(
        rel.relationType,
        rel.subjectId,
        rel.objectId,
        rel.role ?? "",
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
      role: r.role ? String(r.role) : null,
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
    const requirementsImplemented = matrix.filter((r) => r.codeFiles.length > 0).length;
    const requirementsCompliant = matrix.filter((r) => r.compliant).length;

    const commitActivities = this.getActivities().filter(
      (a) => a.activityType === "CommitActivity"
    );
    const relations = this.getRelations();
    const tracedCommitIds = new Set(
      relations
        .filter(
          (rel) =>
            rel.relationType === "used" &&
            rel.subjectId.startsWith("activity:commit:") &&
            (rel.objectId.startsWith("entity:issue:") || rel.objectId.startsWith("entity:req:"))
        )
        .map((rel) => rel.subjectId)
    );
    const tracedCommitsPct =
      commitActivities.length > 0
        ? Math.round((tracedCommitIds.size / commitActivities.length) * 100)
        : 0;

    // Compute issue lead times purely from W3C PROV lifecycle (wasGeneratedBy -> wasInvalidatedBy)
    const issues = [...this.getEntities("Issue"), ...this.getEntities("Bug")];
    const activitiesById = new Map(this.getActivities().map((a) => [a.id, a]));
    const leadHours: number[] = [];
    for (const issue of issues) {
      const genRel = relations.find(
        (r) => r.relationType === "wasGeneratedBy" && r.subjectId === issue.id
      );
      const invRel = relations.find(
        (r) => r.relationType === "wasInvalidatedBy" && r.subjectId === issue.id
      );
      const generatedAt =
        (genRel ? activitiesById.get(genRel.objectId)?.startedAt : null) ?? issue.createdAt;
      const invalidatedAt =
        (typeof invRel?.attributes.time === "string" ? invRel.attributes.time : null) ??
        (invRel ? activitiesById.get(invRel.objectId)?.endedAt : null);

      if (generatedAt && invalidatedAt) {
        const diffMs = new Date(invalidatedAt).getTime() - new Date(generatedAt).getTime();
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
      requirementsCompliant,
      tracedCommitsPct,
      avgIssueLeadTimeHours,
    };
  }

  getRequirementTraces(): RequirementTrace[] {
    const requirements = this.getEntities("Requirement");
    const allEntities = new Map(this.getEntities().map((e) => [e.id, e]));
    const allActivities = new Map(this.getActivities().map((a) => [a.id, a]));
    const allRelations = this.getRelations();
    const derivedRels = allRelations.filter(
      (r) => r.relationType === "wasDerivedFrom" || r.relationType === "wasRevisionOf"
    );

    const derivedFromObject = new Map<string, Set<string>>();
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

      const linkedIssueIds = new Set<string>();
      for (const up of derivedTargets.get(req.id) ?? []) {
        if (up.startsWith("entity:issue:")) linkedIssueIds.add(up);
      }
      for (const down of downstream) {
        if (down.startsWith("entity:issue:")) linkedIssueIds.add(down);
      }

      const codeFiles: ProvEntity[] = [];
      const testFiles: ProvEntity[] = [];
      const pullRequestIds = new Set<string>();
      const artifactIds = new Set<string>();

      for (const id of downstream) {
        const ent = allEntities.get(id);
        if (!ent) continue;
        if (ent.entityType === "CodeArtifact") {
          codeFiles.push(ent);
          artifactIds.add(ent.id);
        }
        if (ent.entityType === "TestArtifact") {
          testFiles.push(ent);
          artifactIds.add(ent.id);
        }
        if (ent.entityType === "PullRequest") pullRequestIds.add(ent.id);
      }

      for (const issueId of linkedIssueIds) {
        for (const child of derivedFromObject.get(issueId) ?? []) {
          const ent = allEntities.get(child);
          if (ent?.entityType === "PullRequest") pullRequestIds.add(ent.id);
        }
      }

      // Also include any PullRequest (prov:Collection) that contains a generated artifact via hadMember
      for (const rel of allRelations) {
        if (
          rel.relationType === "hadMember" &&
          artifactIds.has(rel.objectId) &&
          rel.subjectId.startsWith("entity:pr:")
        ) {
          pullRequestIds.add(rel.subjectId);
        }
      }

      // Collect CommitActivities that used this requirement or generated its code/test artifacts
      const commitActIds = new Set<string>();
      for (const rel of allRelations) {
        if (
          rel.relationType === "used" &&
          rel.objectId === req.id &&
          rel.subjectId.startsWith("activity:commit:")
        ) {
          commitActIds.add(rel.subjectId);
        }
        if (
          rel.relationType === "wasGeneratedBy" &&
          artifactIds.has(rel.subjectId) &&
          rel.objectId.startsWith("activity:commit:")
        ) {
          commitActIds.add(rel.objectId);
        }
      }

      const commitActivities = [...commitActIds]
        .map((id) => allActivities.get(id))
        .filter((a): a is ProvActivity => Boolean(a));

      const issues = [...linkedIssueIds]
        .map((id) => allEntities.get(id))
        .filter((e): e is ProvEntity => Boolean(e));
      const pullRequests = [...pullRequestIds]
        .map((id) => allEntities.get(id))
        .filter((e): e is ProvEntity => Boolean(e));

      return {
        reqId: req.id,
        code: String(req.attributes.code ?? req.id.replace("entity:req:", "")),
        title: String(req.attributes.title ?? req.label),
        specStatus: String(req.attributes.status ?? "Draft"),
        issues,
        pullRequests,
        commitActivities,
        codeFiles,
        testFiles,
      };
    });
  }

  getRequirementsMatrix(rules?: readonly GovernanceRule[]): RequirementTraceRow[] {
    const traces = this.getRequirementTraces();
    const anomalies = evaluateGovernanceRules(this, rules, traces);
    const findingsByNode = new Map<string, ProcessAnomaly[]>();

    for (const anomaly of anomalies) {
      if (!findingsByNode.has(anomaly.nodeId)) findingsByNode.set(anomaly.nodeId, []);
      findingsByNode.get(anomaly.nodeId)!.push(anomaly);
    }

    return traces.map((trace) => {
      const findings = findingsByNode.get(trace.reqId) ?? [];
      return {
        ...trace,
        compliant: findings.length === 0,
        findings,
      };
    });
  }

  getProcessAnomalies(rules?: readonly GovernanceRule[]): ProcessAnomaly[] {
    return evaluateGovernanceRules(this, rules);
  }

  getActivityTimeline() {
    const activities = this.getActivities();
    const relations = this.getRelations();
    const agents = new Map(this.getAgents().map((a) => [a.id, a]));
    const entities = new Map(this.getEntities().map((e) => [e.id, e]));

    return activities
      .map((act) => {
        const associations = relations
          .filter((r) => r.relationType === "wasAssociatedWith" && r.subjectId === act.id)
          .map((r) => {
            const ag = agents.get(r.objectId);
            return ag ? { agent: ag, role: r.role ?? null } : null;
          })
          .filter((item): item is { agent: ProvAgent; role: string | null } => Boolean(item));

        const agent = associations[0]?.agent ?? null;

        const usedEntities = relations
          .filter((r) => r.relationType === "used" && r.subjectId === act.id)
          .map((r) => entities.get(r.objectId))
          .filter((e): e is ProvEntity => Boolean(e));

        const generatedEntities = relations
          .filter((r) => r.relationType === "wasGeneratedBy" && r.objectId === act.id)
          .map((r) => entities.get(r.subjectId))
          .filter((e): e is ProvEntity => Boolean(e));

        const invalidatedEntities = relations
          .filter((r) => r.relationType === "wasInvalidatedBy" && r.objectId === act.id)
          .map((r) => entities.get(r.subjectId))
          .filter((e): e is ProvEntity => Boolean(e));

        return {
          activity: act,
          agent,
          associations,
          usedEntities,
          generatedEntities,
          invalidatedEntities,
        };
      })
      .sort((a, b) => {
        const ta = a.activity.startedAt ?? a.activity.endedAt ?? "";
        const tb = b.activity.startedAt ?? b.activity.endedAt ?? "";
        return ta.localeCompare(tb);
      });
  }

  getGraphData(
    focusId?: string,
    mode: GraphFocusMode = "1hop"
  ): { nodes: ProvGraphNode[]; edges: ProvGraphEdge[] } {
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

    const allRelations = this.getRelations();
    const skippedShortcutRoles = new Set([
      "provtrace:satisfiesRequirement",
      "provtrace:implementsIssue",
      "provtrace:documentsIssue",
    ]);
    const cleanRelations = allRelations.filter((r) => {
      if (r.relationType !== "wasDerivedFrom") return true;
      if (skippedShortcutRoles.has(r.role ?? "")) return false;
      // Only include the 4-column PR -> Issue shortcut when directly focusing that PR or Issue
      if (r.role === "provtrace:resolvesIssue") {
        return r.subjectId === focusId || r.objectId === focusId;
      }
      return true;
    });
    const causalRelationTypes = new Set<ProvRelationType>([
      "wasDerivedFrom",
      "wasRevisionOf",
      "wasGeneratedBy",
      "wasInvalidatedBy",
      "used",
      "hadMember",
    ]);

    if (focusId && allNodes.has(focusId)) {
      if (mode === "1hop") {
        const keep = new Set<string>([focusId]);
        for (const rel of cleanRelations) {
          if (rel.subjectId === focusId && allNodes.has(rel.objectId)) {
            keep.add(rel.objectId);
          }
          if (rel.objectId === focusId && allNodes.has(rel.subjectId)) {
            keep.add(rel.subjectId);
          }
        }

        const nodes = [...keep].map((id) => allNodes.get(id)!).filter(Boolean);
        const edges = cleanRelations
          .filter((r) => r.subjectId === focusId || r.objectId === focusId)
          .map((r) => ({
            relationType: r.relationType,
            from: r.subjectId,
            to: r.objectId,
            role: r.role,
          }));
        return { nodes, edges };
      }

      // Full Lineage mode: directional upstream + downstream derivation without sibling fan-out
      const derivedUp = new Map<string, Set<string>>();
      const derivedDown = new Map<string, Set<string>>();
      for (const r of allRelations) {
        if (r.relationType === "wasDerivedFrom" || r.relationType === "wasRevisionOf") {
          if (!derivedDown.has(r.objectId)) derivedDown.set(r.objectId, new Set());
          derivedDown.get(r.objectId)!.add(r.subjectId);
          if (!derivedUp.has(r.subjectId)) derivedUp.set(r.subjectId, new Set());
          derivedUp.get(r.subjectId)!.add(r.objectId);
        }
      }

      const seeds = new Set<string>([focusId]);
      const directNeighbors = new Set<string>([focusId]);

      for (const r of cleanRelations) {
        if (r.subjectId === focusId && allNodes.has(r.objectId)) {
          directNeighbors.add(r.objectId);
        }
        if (r.objectId === focusId && allNodes.has(r.subjectId)) {
          directNeighbors.add(r.subjectId);
        }
        if (r.relationType === "hadMember" && r.subjectId === focusId) {
          seeds.add(r.objectId);
        }
        if (
          focusId.startsWith("activity:") &&
          (r.subjectId === focusId || r.objectId === focusId) &&
          causalRelationTypes.has(r.relationType)
        ) {
          const otherId = r.subjectId === focusId ? r.objectId : r.subjectId;
          if (otherId.startsWith("entity:") && !otherId.startsWith("entity:file:docs/")) {
            seeds.add(otherId);
          }
        }
      }

      const coreEntities = new Set<string>(seeds);

      // 1. Walk strictly upstream from seeds
      let queue = [...seeds];
      const seenUp = new Set<string>(queue);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const up of derivedUp.get(cur) ?? []) {
          if (!seenUp.has(up) && allNodes.has(up)) {
            seenUp.add(up);
            coreEntities.add(up);
            queue.push(up);
          }
        }
      }

      // 2. Walk strictly downstream from seeds (never feeding upstream ancestors back down)
      queue = [...seeds];
      const seenDown = new Set<string>(queue);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const down of derivedDown.get(cur) ?? []) {
          if (!seenDown.has(down) && allNodes.has(down)) {
            seenDown.add(down);
            coreEntities.add(down);
            queue.push(down);
          }
        }
      }

      const keep = new Set<string>([...coreEntities, ...directNeighbors]);
      for (const r of cleanRelations) {
        if (
          r.relationType === "hadMember" &&
          r.subjectId.startsWith("entity:file:docs/") &&
          coreEntities.has(r.objectId)
        ) {
          keep.add(r.subjectId);
        }
        if (
          r.relationType === "hadMember" &&
          r.subjectId.startsWith("entity:pr:") &&
          coreEntities.has(r.objectId)
        ) {
          keep.add(r.subjectId);
        }
        if (
          r.relationType === "wasGeneratedBy" &&
          coreEntities.has(r.subjectId) &&
          r.objectId.startsWith("activity:commit:") &&
          !r.subjectId.startsWith("entity:file:docs/")
        ) {
          keep.add(r.objectId);
        }
      }

      const nodes = [...keep].map((id) => allNodes.get(id)!).filter(Boolean);
      const edges = cleanRelations
        .filter((r) => {
          if (!keep.has(r.subjectId) || !keep.has(r.objectId)) return false;
          if (r.subjectId === focusId || r.objectId === focusId) return true;
          return causalRelationTypes.has(r.relationType);
        })
        .map((r) => ({
          relationType: r.relationType,
          from: r.subjectId,
          to: r.objectId,
          role: r.role,
        }));
      return { nodes, edges };
    }

    // Overview graph: show Entities + CommitActivities bridged by wasGeneratedBy, used, and direct structural wasDerivedFrom
    const overviewNodes = [...allNodes.values()].filter(
      (n) => n.kind === "entity" || (n.kind === "activity" && n.subType === "CommitActivity")
    );
    const overviewSet = new Set(overviewNodes.map((n) => n.id));

    const edges = cleanRelations
      .filter((r) => {
        if (!overviewSet.has(r.subjectId) || !overviewSet.has(r.objectId)) return false;
        return causalRelationTypes.has(r.relationType);
      })
      .map((r) => ({
        relationType: r.relationType,
        from: r.subjectId,
        to: r.objectId,
        role: r.role,
      }));

    return { nodes: overviewNodes, edges };
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
      const isCollection =
        e.entityType === "DocumentRevision" || e.entityType === "PullRequest";
      entity[e.id] = {
        "prov:type": isCollection
          ? ["prov:Collection", `provtrace:${e.entityType}`]
          : `provtrace:${e.entityType}`,
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
      hadMember: {},
      wasGeneratedBy: {},
      wasInvalidatedBy: {},
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
        case "wasRevisionOf":
          grouped.wasDerivedFrom[key] = {
            "prov:generatedEntity": rel.subjectId,
            "prov:usedEntity": rel.objectId,
            "prov:type": "prov:Revision",
          };
          break;
        case "hadMember":
          grouped.hadMember[key] = {
            "prov:collection": rel.subjectId,
            "prov:entity": rel.objectId,
          };
          break;
        case "wasGeneratedBy":
          grouped.wasGeneratedBy[key] = {
            "prov:entity": rel.subjectId,
            "prov:activity": rel.objectId,
            ...(rel.role ? { "prov:role": rel.role } : {}),
          };
          break;
        case "wasInvalidatedBy":
          grouped.wasInvalidatedBy[key] = {
            "prov:entity": rel.subjectId,
            "prov:activity": rel.objectId,
            ...(rel.role ? { "prov:role": rel.role } : {}),
            ...(typeof rel.attributes.time === "string"
              ? { "prov:time": rel.attributes.time }
              : {}),
          };
          break;
        case "used":
          grouped.used[key] = {
            "prov:activity": rel.subjectId,
            "prov:entity": rel.objectId,
            ...(rel.role ? { "prov:role": rel.role } : {}),
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
            ...(rel.role ? { "prov:role": rel.role } : {}),
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
