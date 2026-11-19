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
		"description": "Every CommitActivity touching production code (category 'code') must reference an upstream GitHub Issue or AsciiDoc Requirement via prov:used.",
	},
	{
		"id": "GOV-002",
		"category": "Unimplemented Spec",
		"severity": "medium",
		"description": "Every Requirement entity extracted from specifications should have at least one implementing CommitActivity in the 'code' category.",
	},
	{
		"id": "GOV-003",
		"category": "Missing Test Coverage",
		"severity": "medium",
		"description": "Every Requirement implemented by 'code' commits must also have at least one CommitActivity in the 'tests' category.",
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
		"Commit activity touches production code (%s) with no prov:used link to any GitHub Issue or AsciiDoc Requirement.",
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
		"Defined in AsciiDoc (%s) with %d linked issue(s), but zero 'code' category commits implement this requirement.",
		[trace.specStatus, count(trace.issues)],
	),
} if {
	some trace in input.requirementTraces
	count(trace.codeCommits) == 0
}

# -----------------------------------------------------------------------------
# GOV-003: Missing Test Coverage
# -----------------------------------------------------------------------------
findings["GOV-003"] contains {
	"nodeId": trace.reqId,
	"label": sprintf("%s: %s", [trace.code, trace.title]),
	"detail": sprintf(
		"Implemented by code commit(s) (%s), but zero 'tests' category commits cover this requirement.",
		[concat(", ", commit_labels)],
	),
} if {
	some trace in input.requirementTraces
	count(trace.codeCommits) > 0
	count(trace.testCommits) == 0
	commit_labels := [object.get(c.attributes, "shortSha", c.label) | some c in trace.codeCommits]
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
