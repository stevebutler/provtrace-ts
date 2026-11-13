# METADATA
# description: Reusable W3C PROV and software-engineering domain vocabulary for ProvTrace governance rules.
# schemas:
#   - input: schema
package provtrace.prov

import rego.v1

# -----------------------------------------------------------------------------
# 1. Entity & Activity Indexing by Subtype
# -----------------------------------------------------------------------------

entities_by_type[entity_type] contains entity if {
	some entity in input.entities
	entity_type := entity.entityType
}

activities_by_type[activity_type] contains activity if {
	some activity in input.activities
	activity_type := activity.activityType
}

commit_activities := object.get(activities_by_type, "CommitActivity", set())

pull_requests := object.get(entities_by_type, "PullRequest", set())

merged_pull_requests contains pr if {
	some pr in pull_requests
	object.get(pr.attributes, "state", "") == "merged"
}

# -----------------------------------------------------------------------------
# 2. Core W3C PROV Relation Predicates
#    Encapsulates subjectId / objectId directionality so audit policies read
#    naturally without low-level relation table details.
# -----------------------------------------------------------------------------

# prov:used(Activity, Entity)
used(activity_id, entity_id) if {
	some rel in input.relations
	rel.relationType == "used"
	rel.subjectId == activity_id
	rel.objectId == entity_id
}

# prov:wasGeneratedBy(Entity, Activity)
was_generated_by(entity_id, activity_id) if {
	some rel in input.relations
	rel.relationType == "wasGeneratedBy"
	rel.subjectId == entity_id
	rel.objectId == activity_id
}

# prov:wasInvalidatedBy(Entity, Activity)
was_invalidated_by(entity_id, activity_id) if {
	some rel in input.relations
	rel.relationType == "wasInvalidatedBy"
	rel.subjectId == entity_id
	rel.objectId == activity_id
}

# prov:wasDerivedFrom(DerivedEntity, SourceEntity)
was_derived_from(derived_id, source_id) if {
	some rel in input.relations
	rel.relationType == "wasDerivedFrom"
	rel.subjectId == derived_id
	rel.objectId == source_id
}

# prov:wasRevisionOf(NewerEntity, OlderEntity)
was_revision_of(newer_id, older_id) if {
	some rel in input.relations
	rel.relationType == "wasRevisionOf"
	rel.subjectId == newer_id
	rel.objectId == older_id
}

# prov:hadMember(CollectionEntity, MemberEntity)
had_member(collection_id, member_id) if {
	some rel in input.relations
	rel.relationType == "hadMember"
	rel.subjectId == collection_id
	rel.objectId == member_id
}

# prov:wasInformedBy(DownstreamActivity, UpstreamActivity)
was_informed_by(downstream_act_id, upstream_act_id) if {
	some rel in input.relations
	rel.relationType == "wasInformedBy"
	rel.subjectId == downstream_act_id
	rel.objectId == upstream_act_id
}

# Qualified prov:wasAssociatedWith(Activity, Agent, Role)
has_associated_role(activity_id, agent_id, expected_role) if {
	some rel in input.relations
	rel.relationType == "wasAssociatedWith"
	rel.subjectId == activity_id
	rel.objectId == agent_id
	object.get(rel, "role", "") == expected_role
}

# -----------------------------------------------------------------------------
# 3. Agent Identity & Delegation Helpers (prov:actedOnBehalfOf)
# -----------------------------------------------------------------------------

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
# 4. Domain Helpers for Commits, Specifications & Pull Request Reviews
# -----------------------------------------------------------------------------

commit_files(commit_act) := object.get(commit_act.attributes, "files", [])

commit_touches_production_code(commit_act) if {
	some file in commit_files(commit_act)
	startswith(file, "src/")
	not endswith(file, "__init__.py")
}

commit_references_governance_artifact(commit_act) if {
	some rel in input.relations
	rel.relationType == "used"
	rel.subjectId == commit_act.id
	is_governance_artifact_id(rel.objectId)
}

is_governance_artifact_id(entity_id) if startswith(entity_id, "entity:issue:")
is_governance_artifact_id(entity_id) if startswith(entity_id, "entity:req:")

pr_review_activity_id(pr) := sprintf("activity:pr-review:%v", [pr.attributes.number])

# Raw reviewer agent IDs directly associated with the PR review activity
pr_reviewer_agent_ids(pr) := [rel.objectId |
	review_act_id := pr_review_activity_id(pr)
	some rel in input.relations
	rel.relationType == "wasAssociatedWith"
	rel.subjectId == review_act_id
	object.get(rel, "role", "") == "reviewer"
]

# Canonical reviewer person IDs for a PullRequest
pr_canonical_reviewers[pr.id] contains canonical_agent_id(agent_id) if {
	some pr in pull_requests
	some agent_id in pr_reviewer_agent_ids(pr)
}

# Canonical author person IDs for a PullRequest (PR author + informing commit authors)
pr_canonical_authors[pr.id] contains canonical_agent_id(rel.objectId) if {
	some pr in pull_requests
	review_act_id := pr_review_activity_id(pr)
	some rel in input.relations
	rel.relationType == "wasAssociatedWith"
	rel.subjectId == review_act_id
	object.get(rel, "role", "") == "author"
}

pr_canonical_authors[pr.id] contains canonical_agent_id(commit_assoc.objectId) if {
	some pr in pull_requests
	review_act_id := pr_review_activity_id(pr)
	some inf in input.relations
	inf.relationType == "wasInformedBy"
	inf.subjectId == review_act_id
	startswith(inf.objectId, "activity:commit:")
	some commit_assoc in input.relations
	commit_assoc.relationType == "wasAssociatedWith"
	commit_assoc.subjectId == inf.objectId
	object.get(commit_assoc, "role", "") == "author"
}
