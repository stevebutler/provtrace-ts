# METADATA
# description: Declarative software development governance rules for ProvTrace.
# schemas:
#   - input: schema
package provtrace.governance

import data.provtrace.prov
import rego.v1

# -----------------------------------------------------------------------------
# Governance Rule Metadata Catalog
#
# Non-developers and compliance leads can revise rule severities ("high",
# "medium", "low"), categories, and descriptions directly in this list.
# See policies/DATA_DICTIONARY.md for available entities, activities, and
# prov.* vocabulary helpers.
# -----------------------------------------------------------------------------
rules := [
	{
		"id": "GOV-001",
		"category": "Untracked Work",
		"severity": "high",
		"description": "Every CommitActivity modifying production source files (src/*) must reference an upstream GitHub Issue or AsciiDoc Requirement via prov:used.",
	},
	{
		"id": "GOV-002",
		"category": "Unimplemented Spec",
		"severity": "medium",
		"description": "Every Requirement entity extracted from specifications should have at least one downstream CodeArtifact via prov:wasDerivedFrom.",
	},
	{
		"id": "GOV-003",
		"category": "Missing Test Coverage",
		"severity": "medium",
		"description": "Every implemented Requirement with derived CodeArtifact entities must also have at least one derived TestArtifact.",
	},
	{
		"id": "GOV-004",
		"category": "Four-Eyes Review",
		"severity": "high",
		"description": "Every merged PullRequest must have a PullRequestReview activity associated with an independent reviewer agent (role='reviewer') distinct from the PR and commit authors.",
	},
]

# -----------------------------------------------------------------------------
# GOV-001: Untracked Work
# -----------------------------------------------------------------------------
findings["GOV-001"] contains {
	"nodeId": commit_act.id,
	"label": commit_act.label,
	"detail": sprintf(
		"Commit activity modifies production source (%s) with no prov:used link to any GitHub Issue or AsciiDoc Requirement.",
		[concat(", ", prov.commit_files(commit_act))],
	),
} if {
	some commit_act in prov.commit_activities
	prov.commit_touches_production_code(commit_act)
	not prov.commit_references_governance_artifact(commit_act)
}

# -----------------------------------------------------------------------------
# GOV-002: Unimplemented Spec
# -----------------------------------------------------------------------------
findings["GOV-002"] contains {
	"nodeId": trace.reqId,
	"label": sprintf("%s: %s", [trace.code, trace.title]),
	"detail": sprintf(
		"Defined in AsciiDoc (%s) with %d linked issue(s), but zero derived CodeArtifact entities exist.",
		[trace.specStatus, count(trace.issues)],
	),
} if {
	some trace in input.requirementTraces
	count(trace.codeFiles) == 0
}

# -----------------------------------------------------------------------------
# GOV-003: Missing Test Coverage
# -----------------------------------------------------------------------------
findings["GOV-003"] contains {
	"nodeId": trace.reqId,
	"label": sprintf("%s: %s", [trace.code, trace.title]),
	"detail": sprintf(
		"Implemented in %s, but no TestArtifact derives from this requirement or its commit activities.",
		[concat(", ", file_names)],
	),
} if {
	some trace in input.requirementTraces
	count(trace.codeFiles) > 0
	count(trace.testFiles) == 0
	file_names := [object.get(f.attributes, "path", f.label) | some f in trace.codeFiles]
}

# -----------------------------------------------------------------------------
# GOV-004: Four-Eyes Review
# -----------------------------------------------------------------------------
findings["GOV-004"] contains {
	"nodeId": pr.id,
	"label": pr.label,
	"detail": "Merged pull request has no prov:wasAssociatedWith agent in role \"reviewer\".",
} if {
	some pr in prov.merged_pull_requests
	reviewers := object.get(prov.pr_canonical_reviewers, pr.id, set())
	count(reviewers) == 0
}

findings["GOV-004"] contains {
	"nodeId": pr.id,
	"label": pr.label,
	"detail": sprintf(
		"Merged pull request was reviewed by %s (role=\"reviewer\"), who also authored the underlying changes (violates 4-eyes segregation of duties).",
		[concat(", ", reviewer_names)],
	),
} if {
	some pr in prov.merged_pull_requests
	reviewers := object.get(prov.pr_canonical_reviewers, pr.id, set())
	count(reviewers) > 0
	authors := object.get(prov.pr_canonical_authors, pr.id, set())
	count(reviewers - authors) == 0
	reviewer_names := [prov.agent_label(id) | some id in prov.pr_reviewer_agent_ids(pr)]
}

# -----------------------------------------------------------------------------
# Aggregated Process Anomalies (ordered by rule catalog)
# -----------------------------------------------------------------------------
anomalies := [
	{
		"ruleId": rule.id,
		"severity": rule.severity,
		"category": rule.category,
		"nodeId": finding.nodeId,
		"label": finding.label,
		"detail": finding.detail,
	} |
	some rule in rules
	rule_findings := object.get(findings, rule.id, set())
	some finding in rule_findings
]
