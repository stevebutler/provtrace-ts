import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { seedTargetRepo } from "../scripts/seed-target-repo.js";
import { ProvStore } from "../src/db/store.js";
import { ExtractionPipeline } from "../src/extractors/pipeline.js";
import { createApp } from "../src/index.js";
import { GOVERNANCE_RULES, type GovernanceRule } from "../src/prov/governance.js";

test("ProvTrace extracts Git, AsciiDoc, and GitHub fixtures into W3C PROV graph", async () => {
  const repoDir = seedTargetRepo();
  const fixtureFile = path.resolve(process.cwd(), "fixtures/github.json");
  const store = new ProvStore(":memory:");
  const pipeline = new ExtractionPipeline(store, repoDir, fixtureFile);

  await pipeline.runAllLoaders(0);

  const stats = store.getSummaryStats();
  assert.equal(stats.requirementsTotal, 4);
  assert.equal(stats.requirementsImplemented, 3); // REQ-001, REQ-002, REQ-003
  assert.equal(stats.requirementsCompliant, 2); // REQ-001, REQ-002 pass all governance rules
  assert.ok(stats.entities >= 20);
  assert.ok(stats.relations >= 50);
  assert.equal(
    store.getEntities().filter((e) => e.id.startsWith("entity:commit:")).length,
    0,
    "Commits should be modeled strictly as prov:Activity, not prov:Entity"
  );

  // Verify W3C PROV Revision links (wasRevisionOf) connect modified file versions to predecessors,
  // while newly added files have no outgoing wasRevisionOf link.
  const revisionRels = store
    .getRelations()
    .filter((r) => r.relationType === "wasRevisionOf");
  assert.equal(
    revisionRels.length,
    3,
    "Only the 3 modified file versions (requirements.adoc v2, ledger.py v2, test_ledger.py v2) should have wasRevisionOf"
  );
  assert.ok(
    revisionRels.every((r) => r.subjectId.startsWith("entity:file:") && r.objectId.startsWith("entity:file:"))
  );
  const newOnlyFiles = store
    .getEntities()
    .filter(
      (e) =>
        e.id.startsWith("entity:file:src/pyledger/budget.py@") ||
        e.id.startsWith("entity:file:src/pyledger/cli.py@")
    );
  assert.equal(newOnlyFiles.length, 2);
  for (const nf of newOnlyFiles) {
    assert.equal(
      revisionRels.filter((r) => r.subjectId === nf.id).length,
      0,
      `Newly added file ${nf.id} must not have a wasRevisionOf predecessor`
    );
  }

  const matrix = store.getRequirementsMatrix();
  const byCode = new Map(matrix.map((r) => [r.code, r]));

  assert.equal(byCode.get("REQ-001")?.compliant, true);
  assert.deepEqual(byCode.get("REQ-001")?.findings, []);
  assert.equal(byCode.get("REQ-002")?.compliant, true);
  assert.equal(byCode.get("REQ-003")?.compliant, false);
  assert.deepEqual(
    byCode.get("REQ-003")?.findings.map((f) => f.ruleId),
    ["GOV-003"]
  );
  assert.equal(byCode.get("REQ-004")?.compliant, false);
  assert.deepEqual(
    byCode.get("REQ-004")?.findings.map((f) => f.ruleId),
    ["GOV-002"]
  );

  const anomalies = store.getProcessAnomalies();
  assert.equal(GOVERNANCE_RULES.length, 3);
  assert.deepEqual(
    anomalies.map((a) => a.ruleId),
    ["GOV-001", "GOV-002", "GOV-003"]
  );
  const categories = anomalies.map((a) => a.category);
  assert.ok(categories.includes("Untracked Work"), "Should detect untracked CLI commit");
  assert.ok(categories.includes("Unimplemented Spec"), "Should detect unimplemented REQ-004");
  assert.ok(categories.includes("Missing Test Coverage"), "Should detect untested REQ-003");

  // Verify custom rules drive both getProcessAnomalies AND getRequirementsMatrix compliance
  const customRule: GovernanceRule = {
    id: "GOV-999",
    category: "Open PR Check",
    severity: "low",
    description: "Flags requirements that still have unmerged pull requests.",
    evaluate: ({ requirementTraces }) =>
      requirementTraces
        .filter((t) => t.pullRequests.some((pr) => pr.attributes.state === "open"))
        .map((t) => ({
          nodeId: t.reqId,
          label: `${t.code}: ${t.title}`,
          detail: "Requirement has an open pull request pending review.",
        })),
  };
  const customFindings = store.getProcessAnomalies([customRule]);
  assert.equal(customFindings.length, 1);
  assert.equal(customFindings[0].ruleId, "GOV-999");

  const customMatrix = store.getRequirementsMatrix([customRule]);
  const customByCode = new Map(customMatrix.map((r) => [r.code, r]));
  assert.equal(customByCode.get("REQ-003")?.compliant, false);
  assert.equal(customByCode.get("REQ-003")?.findings[0]?.ruleId, "GOV-999");
  assert.equal(customByCode.get("REQ-004")?.compliant, true); // Only customRule evaluated
});

test("Hono + JSX + Datastar routes render full page, focus fragments, and PROV-JSON", async () => {
  const store = new ProvStore(":memory:");
  const pipeline = new ExtractionPipeline(store);
  await pipeline.runAllLoaders(0);

  const app = createApp(store, pipeline);

  const homeRes = await app.request("/");
  assert.equal(homeRes.status, 200);
  const homeHtml = await homeRes.text();
  assert.match(homeHtml, /ProvTrace · Provenance Tracer/);
  assert.match(homeHtml, /data-init="@get\(&#39;\/api\/stream&#39;\)"|data-init="@get\('\/api\/stream'\)"/);
  assert.match(homeHtml, /REQ-001/);

  const focusRes = await app.request("/api/focus?id=entity%3Areq%3AREQ-001");
  assert.equal(focusRes.status, 200);
  const focusHtml = await focusRes.text();
  assert.match(focusHtml, /id="explorer-section"/);
  assert.match(focusHtml, /Outgoing PROV Relations/);

  const provRes = await app.request("/api/prov.json");
  assert.equal(provRes.status, 200);
  const provDoc = (await provRes.json()) as Record<string, unknown>;
  assert.ok(provDoc.entity);
  assert.ok(provDoc.wasDerivedFrom);
});
