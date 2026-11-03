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

/**
 * Central registry of software development process-mining governance rules.
 * Add new GovernanceRule definitions here to include them automatically in reports, matrix compliance, and CLI checks.
 */
export const GOVERNANCE_RULES: readonly GovernanceRule[] = [
  untrackedWorkRule,
  unimplementedSpecRule,
  missingTestCoverageRule,
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
