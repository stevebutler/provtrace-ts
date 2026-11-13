# ProvTrace (Provenance Tracer)

A software development process-mining prototype built in TypeScript using **W3C PROV**, **SQLite** (`node:sqlite`), **Hono JSX**, and **Datastar**.

If you are unfamiliar with W3C PROV, see the [W3C PROV Model Primer](https://www.w3.org/TR/prov-primer/) for a concise introduction to `prov:Entity`, `prov:Activity`, `prov:Agent`, and the core relations used throughout ProvTrace.

## What It Connects

ProvTrace extracts artifacts, events, and actors across three development sources for a sample Python project (`target-project/` — `acme/pyledger`):

1. **Local Git Repository (`git-commits`)**: Commit activities (`prov:Activity`), Python source & test file revisions (`prov:Entity`), file revision chains (`prov:wasRevisionOf`), file deletions (`prov:wasInvalidatedBy`), and Git author agents.
2. **AsciiDoc Specifications in Git (`asciidoc-specs`)**: Structured `[[REQ-...]]` sections in `docs/requirements.adoc`, linked as members (`prov:hadMember`) of `prov:Collection` document revisions.
3. **GitHub Issues & Pull Requests (`github-issues`)**: Issues, bugs, `prov:Collection` pull requests, review/resolution activities, issue/PR closure invalidations (`prov:wasInvalidatedBy`), and qualified `prov:Association` agent roles (`author`, `reviewer`, `reporter`, `resolver`) from `fixtures/github.json`.
4. **W3C PROV Cross-Source Linker (`prov-linker`)**: Connects entities, activities, and agents across sources using `prov:wasDerivedFrom`, `prov:wasRevisionOf`, `prov:hadMember`, `prov:wasGeneratedBy`, `prov:wasInvalidatedBy`, `prov:used`, `prov:wasAttributedTo`, `prov:wasAssociatedWith`, `prov:wasInformedBy`, and `prov:actedOnBehalfOf`.

## Web UI Features

The live web application at `http://localhost:3000` is designed **both for open-ended provenance exploration and for automated process/compliance checking**—letting engineers, leads, and auditors interactively trace how software artifacts came to be while spotting process gaps immediately.

### Provenance Exploration
- **Interactive W3C PROV Lineage Graph**: Server-rendered SVG swimlane diagram using standard PROV visual shapes—ovals for `prov:Entity`, rectangles for `prov:Activity`, and pentagons for `prov:Agent`—with color-coded edges (`wasDerivedFrom`, `wasRevisionOf`, `hadMember`, `wasGeneratedBy`, `wasInvalidatedBy`, `used`, and agent attributions) and preset filter pills.
- **2-Hop Neighborhood Focus & Node Inspector**: Clicking any graph node, requirement, commit, PR, agent, or finding focuses the diagram on its 2-hop PROV neighborhood and opens the **Node Inspector** showing incoming/outgoing `prov:*` relations (including qualified roles) and raw JSON attributes.
- **Development Process Event Log**: Chronological `prov:Activity` timeline across issue reports, commits, PR reviews, and closures, showing associated agents with their qualified roles alongside `used` inputs, `wasGeneratedBy` outputs, and `wasInvalidatedBy` retirements.
- **Live Pipeline Controls & Telemetry**: Trigger the full extraction pipeline, run individual extractors, or reset the SQLite store while watching real-time progress bars, record/relation counters, KPIs (including `wasGeneratedBy` → `wasInvalidatedBy` lead times), and logs streamed over Datastar SSE.
- **W3C PROV-JSON Export**: One-click export of the complete provenance graph at `/api/prov.json`.

### Governance & Compliance Checking
- **OPA Rego Policy Engine**: Governance rules and their human-editable metadata (`id`, `category`, `severity`, `description`) live in [`policies/governance.rego`](policies/governance.rego) and execute synchronously in-process via WebAssembly (`@open-policy-agent/opa-wasm`), surfacing process anomalies—such as untracked production commits (`GOV-001`), unimplemented spec requirements (`GOV-002`), missing test coverage (`GOV-003`), and self-reviewed merged PRs violating four-eyes segregation of duties (`GOV-004`)—each with a one-click **Inspect Graph** jump.
- **End-to-End Requirements Traceability Matrix**: Computes transitive `prov:wasDerivedFrom` / `prov:wasRevisionOf` coverage from AsciiDoc `REQ-*` sections across GitHub Issues, PRs, commit activities, Python code, and unit tests, with compliance badges driven directly by governance rule results.

## Quick Start

```bash
# Seed the target Python Git repository (acme/pyledger)
npm run seed

# Run CLI extraction & print summary + process mining anomalies
npm run extract

# Start the live Hono + Datastar web app on http://localhost:3000
npm run dev

# Test & build OPA Rego governance policies (policies/governance.rego -> policies/policy.wasm)
npm run policy:test
npm run policy:build

# Run TypeScript typecheck & test suite
npm run typecheck
npm test
```

## AI contributions

This project was created in Google Antigravity using Gemini 4 Argon.
