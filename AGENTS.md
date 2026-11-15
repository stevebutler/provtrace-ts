# ProvTrace — Agent Guidelines, Domain Vision & Development Workflow

## 1. Domain Vision & Problem Statement

**ProvTrace (Provenance Tracer)** is a software and operations process-mining application for **highly regulated industries** (medical devices, pharmaceuticals, financial services, and safety-critical systems) where every artifact in a released product must have verifiable provenance.

### The Core Problem
In regulated software delivery and operations, evidence is fragmented across many tools and sources of truth:
- **Product Development**: Requirements specifications (AsciiDoc), issue/bug trackers (GitHub Issues), source control (Git), pull requests & code reviews, test plans, formal test execution reports, user manuals, and release notes.
- **Operations & Deployment**: Post-release operations has its own trackers, runbooks, environments, and Infrastructure as Code (IaC) repositories. Formal testing during product development frequently adopts parts of the operational deployment process, and operations includes development activities such as IaC customization.

Because these sources are disconnected:
1. **Process Illegibility & Burnout**: End-to-end release readiness is illegible to management and auditors, who must lean on senior technologists to manually reconstruct status and traceability. This leads to faulty planning and burnout among key technical staff.
2. **Manual Spot-Check "Quality Gates"**: Release audits are traditionally conducted as arduous, hours-long "quality gate" meetings right before release, relying on manual spot-checks rather than complete verification.

### What ProvTrace Does Differently
- **Continuous, 100%-Coverage Quality Gates**: Transforms the software-release quality gate from a late, manual spot-check meeting into an **automated check that can run daily or on every change**, verifying **100% of entities and activities** relevant to a planned release so traceability and compliance gaps are fixed immediately at the source by the people closest to the work.
- **Linked-Data Ontology (W3C PROV)**: Integrates heterogeneous tool data into a common provenance model (`prov:Entity`, `prov:Activity`, `prov:Agent`, and qualified relations such as `wasDerivedFrom`, `wasRevisionOf`, `hadMember`, `used`, `wasGeneratedBy`, `wasInvalidatedBy`, `wasAssociatedWith`, `wasAttributedTo`, `wasInformedBy`, `actedOnBehalfOf`).
- **Exploration + Formal Compliance**:
  - **Exploratory Web UI**: Lets engineers, managers, and auditors visually inspect lineage (`1-Hop` neighborhood and `Full Lineage`), surface hidden assumptions across teams, and evaluate release readiness promises against shared facts.
  - **Declarative Compliance Rules (OPA Rego)**: Codifies quality-gate rules in [`policies/governance.rego`](policies/governance.rego) atop the reusable vocabulary in [`policies/prov.rego`](policies/prov.rego) and [`policies/DATA_DICTIONARY.md`](policies/DATA_DICTIONARY.md), so auditors and compliance leads can read and revise rules without modifying TypeScript code.
- **Designed for Frequent Change**: Adding or replacing data sources (extractors/linkers) and adding or revising compliance rules are routine operations and must remain modular, well-typed, and low-friction.

---

## 2. Autonomous Feature-Branch Workflow

Rather than stopping after every small step in a turn-by-turn loop, work more independently across complete features:

1. **Assess & Clarify Upfront**:
   - When given a user goal, domain problem, or feature request, inspect the relevant code and data model first.
   - If requirements or domain semantics are ambiguous, **stop and ask concise clarifying questions** before building.
   - Once requirements are clear, execute the full feature through implementation, testing, visual verification, and branch commits before stopping.

2. **Work on a Feature Branch**:
   - For multi-step features or model changes, create or switch to a descriptive feature branch (e.g., `git checkout -b feat/<short-name>`) unless instructed to commit directly on `main`.
   - Make logical, atomic commits as cohesive milestones pass verification.

3. **Keep All Contract Layers Synchronized**:
   When adding or modifying data sources, entity/activity types, or provenance links, update all relevant layers together:
   - **Extractors & Cross-Source Linker**: [`src/extractors/`](src/extractors/) and [`src/db/store.ts`](src/db/store.ts)
   - **TypeScript Domain Types**: [`src/prov/types.ts`](src/prov/types.ts)
   - **OPA Schema & Vocabulary**: [`policies/schema.json`](policies/schema.json) and [`policies/prov.rego`](policies/prov.rego)
   - **OPA Governance Rules & Tests**: [`policies/governance.rego`](policies/governance.rego) and [`policies/governance_test.rego`](policies/governance_test.rego)
   - **Auditor Data Dictionary**: [`policies/DATA_DICTIONARY.md`](policies/DATA_DICTIONARY.md)

4. **Self-Verify Code, Policies & UI Behavior Before Stopping**:
   Always run the full verification suite before concluding a feature:
   ```bash
   npm run typecheck
   npm run policy:test
   npm run policy:build
   npm test
   ```
   When changes affect the Web UI, graph layout, or extracted provenance structure:
   - Render the web UI / SVG graphs to PNG using the `ui-visual-check` workspace skill (`.agents/skills/ui-visual-check/SKILL.md`) and inspect the rendered PNG images with `read_file` to verify readability, node placement, and edge routing.
