# ProvTrace Provenance Data Dictionary & Policy Contract

This document is the reference contract for **auditors**, **compliance leads**, and **developers** authoring or reviewing governance rules in [`policies/governance.rego`](governance.rego).

---

## 1. Two-Layer Policy Architecture

To keep compliance rules readable for non-developers while allowing developers to add new extractors, activities, and entities over time, ProvTrace separates policies into three files:

| File | Audience | Responsibility |
| :--- | :--- | :--- |
| [`policies/governance.rego`](governance.rego) | **Auditors & Compliance Leads** | Declares the human-editable `rules` catalog (`id`, `category`, `severity`, `description`) and high-level `findings[rule_id]` conditions using the `prov.*` vocabulary. |
| [`policies/prov.rego`](prov.rego) | **Developers** | Translates raw W3C PROV records (`entities`, `activities`, `agents`, `relations`) and ID conventions into high-level domain sets and predicates (`data.provtrace.prov`). |
| [`policies/schema.json`](schema.json) | **OPA Compiler (`opa check`)** | JSON Schema contract for `input` (`GovernanceContext`). Statically validates `.rego` files via `npm run policy:check` (`opa check --strict --schema policies/schema.json policies/`). |

---

## 2. Top-Level `input` Contract (`GovernanceContext`)

Every policy evaluation receives an `input` JSON document with five top-level arrays:

```json
{
  "entities": [ ... ],
  "activities": [ ... ],
  "agents": [ ... ],
  "relations": [ ... ],
  "requirementTraces": [ ... ]
}
```

---

## 3. W3C PROV Entities (`input.entities`)

Each item in `input.entities` represents a software artifact or specification version (`prov:Entity`):

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Globally unique provenance identifier (e.g., `"entity:req:REQ-001"`). |
| `entityType` | `string` | Domain subtype (see table below). |
| `label` | `string` | Human-readable display label. |
| `source` | `string` | Extractor source (`"git-repo"`, `"asciidoc"`, `"github-issues"`, `"prov-linker"`). |
| `createdAt` | `string \| null` | ISO-8601 creation timestamp. |
| `attributes` | `object` | Subtype-specific metadata attributes (see below). |

### Entity Subtypes & Attributes

| `entityType` | W3C PROV Class | ID Pattern | Key `attributes` |
| :--- | :--- | :--- | :--- |
| `Requirement` | `prov:Entity` | `entity:req:<CODE>` | `code` (`"REQ-001"`), `title`, `status` (`"Approved"` \| `"In Progress"` \| `"Draft"`), `priority`, `sourceRefs` (`string[]` of issue numbers), `file` |
| `DocumentRevision` | `prov:Collection` | `entity:file:<path>@<shortSha>` | `path` (`"docs/requirements.adoc"`), `commit` (full SHA) |
| `CodeArtifact` | `prov:Entity` | `entity:file:<path>@<shortSha>` | `path` (`"src/pyledger/ledger.py"`), `commit` (full SHA) |
| `TestArtifact` | `prov:Entity` | `entity:file:<path>@<shortSha>` | `path` (`"tests/test_ledger.py"`), `commit` (full SHA) |
| `Issue` | `prov:Entity` | `entity:issue:<number>` | `number`, `state` (`"open"` \| `"closed"`), `body`, `labels` (`string[]`) |
| `Bug` | `prov:Entity` | `entity:issue:<number>` | `number`, `state` (`"open"` \| `"closed"`), `body`, `labels` (`string[]`, includes `"bug"`) |
| `PullRequest` | `prov:Collection` | `entity:pr:<number>` | `number`, `state` (`"open"` \| `"merged"` \| `"closed"`), `closes_issues` (`number[]`), `commit_subject_match` |

---

## 4. W3C PROV Activities (`input.activities`)

Each item in `input.activities` represents a time-bounded development action (`prov:Activity`):

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Globally unique activity identifier (e.g., `"activity:commit:8529bc9"`). |
| `activityType` | `string` | Domain subtype (see table below). |
| `label` | `string` | Human-readable summary of the event. |
| `startedAt` | `string \| null` | ISO-8601 start timestamp. |
| `endedAt` | `string \| null` | ISO-8601 completion timestamp. |
| `attributes` | `object` | Subtype-specific metadata attributes (see below). |

### Activity Subtypes & Attributes

| `activityType` | ID Pattern | Key `attributes` |
| :--- | :--- | :--- |
| `CommitActivity` | `activity:commit:<shortSha>` | `sha`, `shortSha`, `subject`, `fullMessage`, `files` (`string[]`), `deletedFiles` (`string[]`) |
| `PullRequestReview` | `activity:pr-review:<prNumber>` | `prNumber` (`number`), `state` (`"open"` \| `"merged"` \| `"closed"`) |
| `IssueReport` | `activity:issue-report:<issueNumber>` | `issueNumber` (`number`) |
| `IssueResolution` | `activity:issue-close:<issueNumber>` | `issueNumber` (`number`) |
| `SpecAuthoring` | `activity:spec-author:<path>@<shortSha>` | `file`, `commit` |

---

## 5. W3C PROV Agents (`input.agents`)

Each item in `input.agents` represents a person or automated tool (`prov:Agent`):

| `agentType` | ID Pattern | Key `attributes` | Notes |
| :--- | :--- | :--- | :--- |
| `Person` (GitHub) | `agent:github:<login>` | `login`, `name`, `email`, `role` | Canonical developer/reviewer/PM identity. |
| `Person` (Git) | `agent:git:<email>` | `name`, `email` | Linked to `agent:github:<login>` via `prov:actedOnBehalfOf` when emails match. |
| `SoftwareAgent` | `agent:bot:<name>` | `name`, `role` | Automated CI/bot actors. |

---

## 6. W3C PROV Relations (`input.relations`)

Each item in `input.relations` is a directed edge `subjectId --[relationType (role)]--> objectId`:

| `relationType` | `subjectId` (From) | `objectId` (To) | Qualified `role` Values | Meaning |
| :--- | :--- | :--- | :--- | :--- |
| `used` | `prov:Activity` | `prov:Entity` | `null` | Activity read, consumed, or referenced the Entity (e.g., commit referencing an Issue/Requirement, or modifying a prior file version). |
| `wasGeneratedBy` | `prov:Entity` | `prov:Activity` | `null` | Entity version was created by the Activity. |
| `wasInvalidatedBy` | `prov:Entity` | `prov:Activity` | `"prov:Invalidate"` (`attributes.kind`: `"file-deleted"` \| `"issue-closed"` \| `"pr-merged"`) | Entity lifecycle ended (file deleted in commit, issue closed, or PR merged/closed). |
| `wasRevisionOf` | Newer `prov:Entity` | Older `prov:Entity` | `"prov:Revision"` | Newer file revision directly evolved from the previous revision of the same file path in Git. |
| `wasDerivedFrom` | Downstream `prov:Entity` | Upstream `prov:Entity` | `"provtrace:specifiedFromIssue"`, `"provtrace:tracksRequirement"`, `"provtrace:issueFollowUp"`, `"provtrace:resolvesIssue"`, `"provtrace:implementsIssue"`, `"provtrace:satisfiesRequirement"` | Downstream artifact traces its design or implementation to the upstream artifact. |
| `hadMember` | `prov:Collection` (`DocumentRevision` or `PullRequest`) | Member `prov:Entity` (`Requirement` or file revision) | `"prov:Collection"` | Collection entity contains the member entity. |
| `wasAttributedTo` | `prov:Entity` | `prov:Agent` | `null` | Entity was authored or reported by the Agent. |
| `wasAssociatedWith` | `prov:Activity` | `prov:Agent` | `"author"`, `"reviewer"`, `"reporter"`, `"resolver"` | Agent participated in the Activity in the specified qualified role (`prov:Association`). |
| `wasInformedBy` | Downstream `prov:Activity` | Upstream `prov:Activity` | `null` | Upstream activity's output or context informed the downstream activity (e.g., `PullRequestReview` informed by `CommitActivity`). |
| `actedOnBehalfOf` | Delegate `prov:Agent` (`agent:git:*`) | Principal `prov:Agent` (`agent:github:*`) | `"provtrace:samePersonIdentity"` | Git commit author identity acts on behalf of the canonical GitHub user sharing the same email. |

---

## 7. Precomputed Requirement Traces (`input.requirementTraces`)

For convenience in specification-coverage rules (`GOV-002`, `GOV-003`), `input.requirementTraces` provides the transitive derivation rollup for each `Requirement`:

| Field | Type | Description |
| :--- | :--- | :--- |
| `reqId` | `string` | Entity ID (`"entity:req:REQ-001"`). |
| `code` | `string` | Short requirement code (`"REQ-001"`). |
| `title` | `string` | Requirement title from AsciiDoc. |
| `specStatus` | `string` | Specification status (`"Approved"`, `"In Progress"`, `"Draft"`). |
| `issues` | `ProvEntity[]` | Linked `Issue` and `Bug` entities. |
| `pullRequests` | `ProvEntity[]` | Linked `PullRequest` entities. |
| `commitActivities` | `ProvActivity[]` | `CommitActivity` records implementing this requirement. |
| `codeFiles` | `ProvEntity[]` | Derived `CodeArtifact` file revisions (`src/*`). |
| `testFiles` | `ProvEntity[]` | Derived `TestArtifact` file revisions (`tests/*`). |

---

## 8. Auditor Vocabulary Reference (`data.provtrace.prov`)

When writing rules in [`policies/governance.rego`](governance.rego), import `data.provtrace.prov` and use these high-level helpers instead of raw relation lookups:

### Collections & Indexing
- `prov.entities_by_type["<EntityType>"]`: Set of all entities of that subtype.
- `prov.activities_by_type["<ActivityType>"]`: Set of all activities of that subtype.
- `prov.commit_activities`: Set of all `CommitActivity` records.
- `prov.pull_requests`: Set of all `PullRequest` entities.
- `prov.merged_pull_requests`: Set of all `PullRequest` entities with `state == "merged"`.

### W3C PROV Relation Predicates
- `prov.used(activity_id, entity_id)`
- `prov.was_generated_by(entity_id, activity_id)`
- `prov.was_invalidated_by(entity_id, activity_id)`
- `prov.was_derived_from(derived_id, source_id)`
- `prov.was_revision_of(newer_id, older_id)`
- `prov.had_member(collection_id, member_id)`
- `prov.was_informed_by(downstream_act_id, upstream_act_id)`
- `prov.has_associated_role(activity_id, agent_id, role_name)`

### Domain & Identity Helpers
- `prov.canonical_agent_id(agent_id)`: Resolves Git author delegates (`agent:git:*`) to canonical GitHub person IDs (`agent:github:*`) via `actedOnBehalfOf`.
- `prov.agent_label(agent_id)`: Human-readable display name for an agent ID.
- `prov.commit_files(commit_act)`: Array of relative file paths modified by `commit_act`.
- `prov.commit_touches_production_code(commit_act)`: True when `commit_act` modifies at least one non-`__init__.py` file under `src/`.
- `prov.commit_references_governance_artifact(commit_act)`: True when `commit_act` has a `prov:used` link to any `Issue`, `Bug`, or `Requirement`.
- `prov.pr_canonical_reviewers[pr.id]`: Set of canonical agent IDs who reviewed `pr` (`role == "reviewer"`).
- `prov.pr_canonical_authors[pr.id]`: Set of canonical agent IDs who authored `pr` or any commit informing `pr` (`role == "author"`).

---

## 9. How to Extend the Model

1. **Adding a new Entity or Activity subtype**:
   - Add the subtype name to [`src/prov/types.ts`](../src/prov/types.ts) and [`policies/schema.json`](schema.json).
   - Add convenience sets or predicates in [`policies/prov.rego`](prov.rego) (e.g., `security_scans := object.get(activities_by_type, "SecurityScan", set())`).
   - Document the subtype and its attributes in this file (`policies/DATA_DICTIONARY.md`).
2. **Adding or editing a Governance Rule**:
   - Add or edit the metadata entry in `rules` at the top of [`policies/governance.rego`](governance.rego).
   - Define `findings["GOV-XXX"] contains { "nodeId": ..., "label": ..., "detail": ... } if { ... }`.
   - Run `npm run policy:test` (which runs `opa check --strict --schema policies/schema.json` and `opa test policies/ -v`) and `npm run policy:build`.
