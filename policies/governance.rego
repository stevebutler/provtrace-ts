package provtrace.governance

import rego.v1

# -----------------------------------------------------------------------------
# Governance Rule Metadata Catalog
#
# Non-developers and compliance leads can revise rule severities ("high",
# "medium", "low"), categories, and descriptions directly in this list.
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
		[concat(", ", files)],
	),
} if {
	some commit_act in input.activities
	commit_act.activityType == "CommitActivity"
	files := object.get(commit_act.attributes, "files", [])
	touches_production_src(files)
	not has_governance_input(commit_act.id)
}

touches_production_src(files) if {
	some file in files
	startswith(file, "src/")
	not endswith(file, "__init__.py")
}

has_governance_input(commit_id) if {
	some rel in input.relations
	rel.relationType == "used"
	rel.subjectId == commit_id
	is_governance_entity(rel.objectId)
}

is_governance_entity(entity_id) if startswith(entity_id, "entity:issue:")
is_governance_entity(entity_id) if startswith(entity_id, "entity:req:")

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
	some pr in merged_pull_requests
	review_act_id := pr_review_activity_id(pr)
	reviewer_assocs := pr_reviewer_associations(review_act_id)
	count(reviewer_assocs) == 0
}

findings["GOV-004"] contains {
	"nodeId": pr.id,
	"label": pr.label,
	"detail": sprintf(
		"Merged pull request was reviewed by %s (role=\"reviewer\"), who also authored the underlying changes (violates 4-eyes segregation of duties).",
		[concat(", ", reviewer_names)],
	),
} if {
	some pr in merged_pull_requests
	review_act_id := pr_review_activity_id(pr)
	reviewer_assocs := pr_reviewer_associations(review_act_id)
	count(reviewer_assocs) > 0
	authors := object.get(pr_author_canonical_ids, review_act_id, set())
	independent := [r |
		some r in reviewer_assocs
		not canonical_agent_id(r.objectId) in authors
	]
	count(independent) == 0
	reviewer_names := [agent_label(r.objectId) | some r in reviewer_assocs]
}

merged_pull_requests contains pr if {
	some pr in input.entities
	pr.entityType == "PullRequest"
	object.get(pr.attributes, "state", "") == "merged"
}

pr_review_activity_id(pr) := sprintf("activity:pr-review:%v", [pr.attributes.number])

pr_reviewer_associations(review_act_id) := [rel |
	some rel in input.relations
	rel.relationType == "wasAssociatedWith"
	rel.subjectId == review_act_id
	object.get(rel, "role", "") == "reviewer"
]

pr_author_canonical_ids[review_act_id] contains canonical_agent_id(rel.objectId) if {
	some rel in input.relations
	rel.relationType == "wasAssociatedWith"
	startswith(rel.subjectId, "activity:pr-review:")
	review_act_id := rel.subjectId
	object.get(rel, "role", "") == "author"
}

pr_author_canonical_ids[review_act_id] contains canonical_agent_id(commit_assoc.objectId) if {
	some inf in input.relations
	inf.relationType == "wasInformedBy"
	startswith(inf.subjectId, "activity:pr-review:")
	startswith(inf.objectId, "activity:commit:")
	review_act_id := inf.subjectId
	some commit_assoc in input.relations
	commit_assoc.relationType == "wasAssociatedWith"
	commit_assoc.subjectId == inf.objectId
	object.get(commit_assoc, "role", "") == "author"
}

canonical_agent_id(agent_id) := delegate.objectId if {
	some delegate in input.relations
	delegate.relationType == "actedOnBehalfOf"
	delegate.subjectId == agent_id
} else := agent_id

agent_label(agent_id) := ag.label if {
	some ag in input.agents
	ag.id == agent_id
} else := agent_id

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
