package provtrace.governance_test

import data.provtrace.governance
import data.provtrace.prov
import rego.v1

test_rules_metadata_catalog if {
	count(governance.rules) == 4
	rule_ids := [r.id | some r in governance.rules]
	rule_ids == ["GOV-001", "GOV-002", "GOV-003", "GOV-004"]
}

test_prov_vocabulary_predicates if {
	mock_input := {
		"entities": [
			{
				"id": "entity:issue:1",
				"entityType": "Issue",
				"label": "Issue #1",
				"source": "github-issues",
				"attributes": {"number": 1, "state": "open"},
			},
			{
				"id": "entity:pr:10",
				"entityType": "PullRequest",
				"label": "PR #10",
				"source": "github-issues",
				"attributes": {"number": 10, "state": "merged"},
			},
		],
		"activities": [{
			"id": "activity:commit:abc",
			"activityType": "CommitActivity",
			"label": "abc: Initial commit",
			"attributes": {
				"categories": ["code", "tests"],
				"files": ["src/pyledger/ledger.py", "tests/test_ledger.py"],
			},
		}],
		"agents": [
			{"id": "agent:github:alice-pm", "agentType": "Person", "label": "Alice", "attributes": {}},
			{"id": "agent:git:alice", "agentType": "Person", "label": "Alice Git", "attributes": {}},
		],
		"relations": [
			{
				"relationType": "used",
				"subjectId": "activity:commit:abc",
				"objectId": "entity:issue:1",
			},
			{
				"relationType": "hadMember",
				"subjectId": "entity:pr:10",
				"objectId": "activity:commit:abc",
			},
			{
				"relationType": "actedOnBehalfOf",
				"subjectId": "agent:git:alice",
				"objectId": "agent:github:alice-pm",
			},
		],
		"requirementTraces": [],
	}

	prov.used("activity:commit:abc", "entity:issue:1") with input as mock_input
	prov.canonical_agent_id("agent:git:alice") == "agent:github:alice-pm" with input as mock_input
	count(prov.entities_by_type.Issue) == 1 with input as mock_input
	count(prov.pr_commits["entity:pr:10"]) == 1 with input as mock_input
}

test_gov_001_untracked_work if {
	mock_input := {
		"entities": [],
		"activities": [
			{
				"id": "activity:commit:abc1234",
				"activityType": "CommitActivity",
				"label": "abc1234: Quick hotfix",
				"attributes": {
					"categories": ["code"],
					"files": ["src/pyledger/cli.py"],
				},
			},
			{
				"id": "activity:commit:def5678",
				"activityType": "CommitActivity",
				"label": "def5678: Traced commit",
				"attributes": {
					"categories": ["code", "tests"],
					"files": ["src/pyledger/ledger.py"],
				},
			},
		],
		"agents": [],
		"relations": [{
			"relationType": "used",
			"subjectId": "activity:commit:def5678",
			"objectId": "entity:issue:1",
		}],
		"requirementTraces": [],
	}

	res := governance.anomalies with input as mock_input
	count(res) == 1
	res[0].ruleId == "GOV-001"
	res[0].nodeId == "activity:commit:abc1234"
}

test_gov_002_and_003_requirement_traces if {
	mock_input := {
		"entities": [],
		"activities": [],
		"agents": [],
		"relations": [],
		"requirementTraces": [
			{
				"reqId": "entity:req:REQ-001",
				"code": "REQ-001",
				"title": "Compliant Req",
				"specStatus": "Approved",
				"issues": [{"id": "entity:issue:1", "entityType": "Issue", "label": "#1", "source": "github-issues", "attributes": {}}],
				"codeCommits": [{"id": "activity:commit:8529bc9", "activityType": "CommitActivity", "label": "8529bc9: Impl", "attributes": {"shortSha": "8529bc9", "categories": ["code", "tests"]}}],
				"testCommits": [{"id": "activity:commit:8529bc9", "activityType": "CommitActivity", "label": "8529bc9: Impl", "attributes": {"shortSha": "8529bc9", "categories": ["code", "tests"]}}],
			},
			{
				"reqId": "entity:req:REQ-003",
				"code": "REQ-003",
				"title": "Untested Req",
				"specStatus": "Approved",
				"issues": [{"id": "entity:issue:4", "entityType": "Issue", "label": "#4", "source": "github-issues", "attributes": {}}],
				"codeCommits": [{"id": "activity:commit:80c1cef", "activityType": "CommitActivity", "label": "80c1cef: Budget", "attributes": {"shortSha": "80c1cef", "categories": ["code"]}}],
				"testCommits": [],
			},
			{
				"reqId": "entity:req:REQ-004",
				"code": "REQ-004",
				"title": "Unimplemented Req",
				"specStatus": "Draft",
				"issues": [],
				"codeCommits": [],
				"testCommits": [],
			},
		],
	}

	res := governance.anomalies with input as mock_input
	count(res) == 2
	rule_ids := [a.ruleId | some a in res]
	rule_ids == ["GOV-002", "GOV-003"]
}

test_gov_004_four_eyes_review_with_delegation if {
	mock_input := {
		"entities": [{
			"id": "entity:pr:11",
			"entityType": "PullRequest",
			"label": "PR #11: Fix split_amount",
			"source": "github-issues",
			"attributes": {"number": 11, "state": "merged"},
		}],
		"activities": [{
			"id": "activity:commit:c1",
			"activityType": "CommitActivity",
			"label": "c1: Fix split_amount",
			"attributes": {"categories": ["code", "tests"]},
		}],
		"agents": [
			{"id": "agent:github:bob-dev", "agentType": "Person", "label": "Bob (@bob-dev)", "attributes": {}},
			{"id": "agent:git:bob", "agentType": "Person", "label": "Bob Git", "attributes": {}},
		],
		"relations": [
			{
				"relationType": "used",
				"subjectId": "activity:commit:c1",
				"objectId": "entity:issue:3",
			},
			{
				"relationType": "actedOnBehalfOf",
				"subjectId": "agent:git:bob",
				"objectId": "agent:github:bob-dev",
			},
			{
				"relationType": "hadMember",
				"subjectId": "entity:pr:11",
				"objectId": "activity:commit:c1",
			},
			{
				"relationType": "wasAssociatedWith",
				"subjectId": "activity:commit:c1",
				"objectId": "agent:git:bob",
				"role": "author",
			},
			{
				"relationType": "wasAssociatedWith",
				"subjectId": "activity:pr-review:11",
				"objectId": "agent:github:bob-dev",
				"role": "reviewer",
			},
		],
		"requirementTraces": [],
	}

	res := governance.anomalies with input as mock_input
	count(res) == 1
	res[0].ruleId == "GOV-004"
	res[0].nodeId == "entity:pr:11"
}
