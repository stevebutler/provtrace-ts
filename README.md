# ProvTrace (Provenance Tracer)

A software development process-mining prototype built in TypeScript using **W3C PROV**, **SQLite** (`node:sqlite`), **Hono JSX**, and **Datastar**.

## What It Connects

ProvTrace extracts artifacts, events, and actors across three development sources for a sample Python project (`target-project/` — `acme/pyledger`):

1. **Local Git Repository (`git-commits`)**: Commits, Python source & test file revisions, commit activities, and author agents.
2. **AsciiDoc Specifications in Git (`asciidoc-specs`)**: Structured `[[REQ-...]]` sections in `docs/requirements.adoc` linked to document revisions.
3. **GitHub Issues & Pull Requests (`github-issues`)**: Issues, bugs, pull requests, review/resolution activities, and GitHub user agents from `fixtures/github.json`.
4. **W3C PROV Cross-Source Linker (`prov-linker`)**: Connects entities, activities, and agents using `prov:wasDerivedFrom`, `prov:wasGeneratedBy`, `prov:used`, `prov:wasAttributedTo`, `prov:wasAssociatedWith`, `prov:wasInformedBy`, and `prov:actedOnBehalfOf`.

## Quick Start

```bash
# Seed the target Python Git repository (acme/pyledger)
npm run seed

# Run CLI extraction & print summary + process mining anomalies
npm run extract

# Start the live Hono + Datastar web app on http://localhost:3000
npm run dev

# Run TypeScript typecheck & test suite
npm run typecheck
npm test
```
