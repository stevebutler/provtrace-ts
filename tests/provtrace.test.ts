import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { seedTargetRepo } from "../scripts/seed-target-repo.js";
import { ProvStore } from "../src/db/store.js";
import { ExtractionPipeline } from "../src/extractors/pipeline.js";
import { createApp } from "../src/index.js";

test("ProvTrace extracts Git, AsciiDoc, and GitHub fixtures into W3C PROV graph", async () => {
  const repoDir = seedTargetRepo();
  const fixtureFile = path.resolve(process.cwd(), "fixtures/github.json");
  const store = new ProvStore(":memory:");
  const pipeline = new ExtractionPipeline(store, repoDir, fixtureFile);

  await pipeline.runAllLoaders(0);

  const stats = store.getSummaryStats();
  assert.equal(stats.requirementsTotal, 4);
  assert.equal(stats.requirementsImplemented, 3); // REQ-001, REQ-002, REQ-003
  assert.equal(stats.requirementsVerified, 2); // REQ-001, REQ-002 have unit tests
  assert.ok(stats.entities >= 20);
  assert.ok(stats.relations >= 50);

  const matrix = store.getRequirementsMatrix();
  const byCode = new Map(matrix.map((r) => [r.code, r]));

  assert.equal(byCode.get("REQ-001")?.compliance, "verified");
  assert.equal(byCode.get("REQ-002")?.compliance, "verified");
  assert.equal(byCode.get("REQ-003")?.compliance, "untested");
  assert.equal(byCode.get("REQ-004")?.compliance, "unimplemented");

  const anomalies = store.getProcessAnomalies();
  const categories = anomalies.map((a) => a.category);
  assert.ok(categories.includes("Untracked Work"), "Should detect untracked CLI commit");
  assert.ok(categories.includes("Unimplemented Spec"), "Should detect unimplemented REQ-004");
  assert.ok(categories.includes("Missing Test Coverage"), "Should detect untested REQ-003");
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
