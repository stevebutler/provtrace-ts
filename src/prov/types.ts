export type EntityType =
  | "Issue"
  | "Bug"
  | "Requirement"
  | "DocumentRevision"
  | "PullRequest"
  | "CodeArtifact"
  | "TestArtifact";

export type ActivityType =
  | "IssueReport"
  | "IssueResolution"
  | "SpecAuthoring"
  | "CommitActivity"
  | "PullRequestReview";

export type AgentType = "Person" | "SoftwareAgent";

export type ProvRelationType =
  | "wasDerivedFrom"
  | "wasGeneratedBy"
  | "used"
  | "wasAttributedTo"
  | "wasAssociatedWith"
  | "wasInformedBy"
  | "actedOnBehalfOf";

export type SourceSystem = "github-issues" | "git-repo" | "asciidoc" | "prov-linker";

export type LoaderName = "git-commits" | "asciidoc-specs" | "github-issues" | "prov-linker";

export type LoaderState = "idle" | "running" | "completed" | "failed";

export interface ProvEntity {
  id: string;
  entityType: EntityType;
  label: string;
  source: SourceSystem;
  createdAt: string | null;
  attributes: Record<string, unknown>;
}

export interface ProvActivity {
  id: string;
  activityType: ActivityType;
  label: string;
  source: SourceSystem;
  startedAt: string | null;
  endedAt: string | null;
  attributes: Record<string, unknown>;
}

export interface ProvAgent {
  id: string;
  agentType: AgentType;
  label: string;
  attributes: Record<string, unknown>;
}

export interface ProvRelation {
  id?: number;
  relationType: ProvRelationType;
  subjectId: string;
  objectId: string;
  role?: string | null;
  attributes: Record<string, unknown>;
}

export interface LoaderStatusRecord {
  loaderName: LoaderName;
  title: string;
  description: string;
  status: LoaderState;
  progressPct: number;
  itemsProcessed: number;
  relationsCreated: number;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  error: string | null;
}

export interface LoaderLogEntry {
  id: number;
  timestamp: string;
  loaderName: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RequirementTraceRow {
  reqId: string;
  code: string;
  title: string;
  specStatus: string;
  issues: ProvEntity[];
  pullRequests: ProvEntity[];
  commitActivities: ProvActivity[];
  codeFiles: ProvEntity[];
  testFiles: ProvEntity[];
  compliance: "verified" | "untested" | "unimplemented";
}

export interface ProcessAnomaly {
  severity: "high" | "medium" | "low";
  category: "Untracked Work" | "Unimplemented Spec" | "Missing Test Coverage";
  nodeId: string;
  label: string;
  detail: string;
}

export interface SummaryStats {
  entities: number;
  activities: number;
  agents: number;
  relations: number;
  requirementsTotal: number;
  requirementsImplemented: number;
  requirementsVerified: number;
  tracedCommitsPct: number;
  avgIssueLeadTimeHours: number | null;
}

export interface ProvGraphNode {
  id: string;
  kind: "entity" | "activity" | "agent";
  subType: string;
  label: string;
  shortId: string;
}

export interface ProvGraphEdge {
  relationType: ProvRelationType;
  from: string;
  to: string;
  role?: string | null;
}
