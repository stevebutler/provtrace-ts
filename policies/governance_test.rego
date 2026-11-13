package provtrace.governance_test

import data.provtrace.governance
import rego.v1

test_rules_metadata_catalog if {
	count(governance.rules) == 4
	rule_ids := [r.id | some r in governance.rules]
	rule_ids == ["GOV-001", "GOV-002", "GOV-003", "GOV-004"]
}

test_gov_001_untracked_work if {
	mock_input := {
		"entities": [],
		"activities": [
			{
				"id": "activity:commit:abc1234",
				"activityType": "CommitActivity",
				"label": "abc1234: Quick hotfix",
				"attributes": {"files": ["src/pyledger/cli.py"]},
			},
			{
				"id": "activity:commit:def5678",
				"activityType": "CommitActivity",
				"label": "def5678: Traced commit",
				"attributes": {"files": ["src/pyledger/ledger.py"]},
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
				"issues": [{"id": "entity:issue:1"}],
				"codeFiles": [{"id": "entity:file:1", "label": "ledger.py", "attributes": {"path": "src/pyledger/ledger.py"}}],
				"testFiles": [{"id": "entity:file:2", "label": "test_ledger.py", "attributes": {"path": "tests/test_ledger.py"}}],
			},
			{
				"reqId": "entity:req:REQ-003",
				"code": "REQ-003",
				"title": "Untested Req",
				"specStatus": "Approved",
				"issues": [{"id": "entity:issue:3"}],
				"codeFiles": [{"id": "entity:file:3", "label": "budget.py", "attributes": {"path": "src/pyledger/budget.py"}}],
				"testFiles": [],
			},
			{
				"reqId": "entity:req:REQ-004",
				"code": "REQ-004",
				"title": "Unimplemented Req",
				"specStatus": "Draft",
				"issues": [],
				"codeFiles": [],
				"testFiles": [],
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
			"attributes": {"number": 11, "state": "merged"},
		}],
		"activities": [],
		"agents": [
			{"id": "agent:github:bob-dev", "label": "Bob (@bob-dev)"},
			{"id": "agent:git:bob", "label": "Bob Git"},
		],
		"relations": [
			{
				"relationType": "actedOnBehalfOf",
				"subjectId": "agent:git:bob",
				"objectId": "agent:github:bob-dev",
			},
			{
				"relationType": "wasInformedBy",
				"subjectId": "activity:pr-review:11",
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
