import type { ProvStore } from "../db/store.js";
import type {
  AnomalySeverity,
  ProcessAnomaly,
  ProvActivity,
  ProvAgent,
  ProvEntity,
  ProvRelation,
  RequirementTrace,
} from "./types.js";

export interface GovernanceContext {
  entities: ProvEntity[];
  activities: ProvActivity[];
  agents: ProvAgent[];
  relations: ProvRelation[];
  requirementTraces: RequirementTrace[];
}

export interface GovernanceRuleFinding {
  nodeId: string;
  label: string;
  detail: string;
}

export interface GovernanceRule {
  id: string;
  category: string;
  severity: AnomalySeverity;
  description: string;
  evaluate: (ctx: GovernanceContext) => GovernanceRuleFinding[];
}

export const untrackedWorkRule: GovernanceRule = {
  id: "GOV-001",
  category: "Untracked Work",
  severity: "high",
  description:
    "Every CommitActivity modifying production source files (src/*) must reference an upstream GitHub Issue or AsciiDoc Requirement via prov:used.",
  evaluate({ activities, relations }) {
    const findings: GovernanceRuleFinding[] = [];
    const commitActivities = activities.filter((a) => a.activityType === "CommitActivity");

    for (const commitAct of commitActivities) {
      const files = (commitAct.attributes.files as string[] | undefined) ?? [];
      const touchesSrc = files.some((f) => f.startsWith("src/") && !f.endsWith("__init__.py"));
      if (!touchesSrc) continue;

      const hasGovernanceInput = relations.some(
        (r) =>
          r.relationType === "used" &&
          r.subjectId === commitAct.id &&
          (r.objectId.startsWith("entity:issue:") || r.objectId.startsWith("entity:req:"))
      );

      if (!hasGovernanceInput) {
        findings.push({
          nodeId: commitAct.id,
          label: commitAct.label,
          detail: `Commit activity modifies production source (${files.join(", ")}) with no prov:used link to any GitHub Issue or AsciiDoc Requirement.`,
        });
      }
    }

    return findings;
  },
};

export const unimplementedSpecRule: GovernanceRule = {
  id: "GOV-002",
  category: "Unimplemented Spec",
  severity: "medium",
  description:
    "Every Requirement entity extracted from specifications should have at least one downstream CodeArtifact via prov:wasDerivedFrom.",
  evaluate({ requirementTraces }) {
    return requirementTraces
      .filter((trace) => trace.codeFiles.length === 0)
      .map((trace) => ({
        nodeId: trace.reqId,
        label: `${trace.code}: ${trace.title}`,
        detail: `Defined in AsciiDoc (${trace.specStatus}) with ${trace.issues.length} linked issue(s), but zero derived CodeArtifact entities exist.`,
      }));
  },
};

export const missingTestCoverageRule: GovernanceRule = {
  id: "GOV-003",
  category: "Missing Test Coverage",
  severity: "medium",
  description:
    "Every implemented Requirement with derived CodeArtifact entities must also have at least one derived TestArtifact.",
  evaluate({ requirementTraces }) {
    return requirementTraces
      .filter((trace) => trace.codeFiles.length > 0 && trace.testFiles.length === 0)
      .map((trace) => {
        const fileNames = trace.codeFiles
          .map((f) => String(f.attributes.path ?? f.label))
          .join(", ");
        return {
          nodeId: trace.reqId,
          label: `${trace.code}: ${trace.title}`,
          detail: `Implemented in ${fileNames}, but no TestArtifact derives from this requirement or its commit activities.`,
        };
      });
  },
};

export const fourEyesReviewRule: GovernanceRule = {
  id: "GOV-004",
  category: "Four-Eyes Review",
  severity: "high",
  description:
    "Every merged PullRequest must have a PullRequestReview activity associated with an independent reviewer agent (role='reviewer') distinct from the PR and commit authors.",
  evaluate({ entities, agents, relations }) {
    const findings: GovernanceRuleFinding[] = [];
    const agentById = new Map(agents.map((a) => [a.id, a]));

    // Map delegate Git agents -> canonical GitHub person agents via prov:actedOnBehalfOf
    const canonicalAgentId = (agentId: string): string => {
      const delegateRel = relations.find(
        (r) => r.relationType === "actedOnBehalfOf" && r.subjectId === agentId
      );
      return delegateRel ? delegateRel.objectId : agentId;
    };

    const mergedPrs = entities.filter(
      (e) => e.entityType === "PullRequest" && e.attributes.state === "merged"
    );

    for (const pr of mergedPrs) {
      const prNum = Number(pr.attributes.number);
      const reviewActId = `activity:pr-review:${prNum}`;

      const prAssocs = relations.filter(
        (r) => r.relationType === "wasAssociatedWith" && r.subjectId === reviewActId
      );

      // Authors include PR author association + commit authors informing this PR review
      const authorCanonicalIds = new Set<string>();
      for (const assoc of prAssocs) {
        if (assoc.role === "author") {
          authorCanonicalIds.add(canonicalAgentId(assoc.objectId));
        }
      }

      const informedCommitIds = relations
        .filter(
          (r) =>
            r.relationType === "wasInformedBy" &&
            r.subjectId === reviewActId &&
            r.objectId.startsWith("activity:commit:")
        )
        .map((r) => r.objectId);

      for (const commitActId of informedCommitIds) {
        for (const r of relations) {
          if (
            r.relationType === "wasAssociatedWith" &&
            r.subjectId === commitActId &&
            r.role === "author"
          ) {
            authorCanonicalIds.add(canonicalAgentId(r.objectId));
          }
        }
      }

      const reviewerAssocs = prAssocs.filter((r) => r.role === "reviewer");
      if (reviewerAssocs.length === 0) {
        findings.push({
          nodeId: pr.id,
          label: pr.label,
          detail: `Merged pull request has no prov:wasAssociatedWith agent in role "reviewer".`,
        });
        continue;
      }

      const independentReviewers = reviewerAssocs.filter(
        (r) => !authorCanonicalIds.has(canonicalAgentId(r.objectId))
      );

      if (independentReviewers.length === 0) {
        const reviewerNames = reviewerAssocs
          .map((r) => agentById.get(r.objectId)?.label ?? r.objectId)
          .join(", ");
        findings.push({
          nodeId: pr.id,
          label: pr.label,
          detail: `Merged pull request was reviewed by ${reviewerNames} (role="reviewer"), who also authored the underlying changes (violates 4-eyes segregation of duties).`,
        });
      }
    }

    return findings;
  },
};

/**
 * Central registry of software development process-mining governance rules.
 * Add new GovernanceRule definitions here to include them automatically in reports, matrix compliance, and CLI checks.
 */
export const GOVERNANCE_RULES: readonly GovernanceRule[] = [
  untrackedWorkRule,
  unimplementedSpecRule,
  missingTestCoverageRule,
  fourEyesReviewRule,
];

export function evaluateGovernanceRules(
  store: ProvStore,
  rules: readonly GovernanceRule[] = GOVERNANCE_RULES,
  precomputedTraces?: RequirementTrace[]
): ProcessAnomaly[] {
  const ctx: GovernanceContext = {
    entities: store.getEntities(),
    activities: store.getActivities(),
    agents: store.getAgents(),
    relations: store.getRelations(),
    requirementTraces: precomputedTraces ?? store.getRequirementTraces(),
  };

  const anomalies: ProcessAnomaly[] = [];
  for (const rule of rules) {
    for (const finding of rule.evaluate(ctx)) {
      anomalies.push({
        ruleId: rule.id,
        severity: rule.severity,
        category: rule.category,
        nodeId: finding.nodeId,
        label: finding.label,
        detail: finding.detail,
      });
    }
  }
  return anomalies;
}
