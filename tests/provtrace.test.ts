import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { seedTargetRepo } from "../scripts/seed-target-repo.js";
import { ProvStore } from "../src/db/store.js";
import { ExtractionPipeline } from "../src/extractors/pipeline.js";
import { createApp } from "../src/index.js";
import { GOVERNANCE_RULES, type GovernanceRule } from "../src/prov/governance.js";
import { type AuthConfig, loadAuthConfigFromEnv } from "../src/web/auth.js";

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
  assert.equal(stats.entities, 12); // 5 Issues/Bugs + 4 Requirements + 3 PullRequests (zero file-version nodes)
  assert.equal(stats.activities, 17);
  assert.ok(stats.relations >= 50);

  assert.equal(
    store.getEntities().filter((e) => e.id.startsWith("entity:commit:")).length,
    0,
    "Commits should be modeled strictly as prov:Activity, not prov:Entity"
  );
  assert.equal(
    store.getEntities().filter((e) => e.id.startsWith("entity:file:")).length,
    0,
    "Per-file-version entities should not be created; commits are classified by repo categories instead"
  );

  // Verify CommitActivity repo-area categories and deleted file metadata
  const commitsById = new Map(
    store
      .getActivities()
      .filter((a) => a.activityType === "CommitActivity")
      .map((a) => [a.id, a])
  );
  assert.deepEqual(commitsById.get("activity:commit:ab840bb")?.attributes.categories, [
    "docs",
    "config",
  ]);
  assert.deepEqual(commitsById.get("activity:commit:8529bc9")?.attributes.categories, [
    "code",
    "tests",
  ]);
  assert.deepEqual(commitsById.get("activity:commit:8529bc9")?.attributes.deletedFiles, [
    "docs/scratch-notes.txt",
  ]);
  assert.deepEqual(commitsById.get("activity:commit:7d0a0c3")?.attributes.categories, [
    "code",
    "tests",
  ]);
  assert.deepEqual(commitsById.get("activity:commit:688a992")?.attributes.categories, ["docs"]);
  assert.deepEqual(commitsById.get("activity:commit:80c1cef")?.attributes.categories, ["code"]);
  assert.deepEqual(commitsById.get("activity:commit:8544bfb")?.attributes.categories, ["code"]);

  // Verify AsciiDoc Requirements link via wasGeneratedBy to the docs commit that introduced them
  const reqGenRels = store
    .getRelations()
    .filter((r) => r.relationType === "wasGeneratedBy" && r.subjectId.startsWith("entity:req:"));
  assert.deepEqual(
    reqGenRels.map((r) => ({ req: r.subjectId, commit: r.objectId })),
    [
      { req: "entity:req:REQ-001", commit: "activity:commit:ab840bb" },
      { req: "entity:req:REQ-002", commit: "activity:commit:ab840bb" },
      { req: "entity:req:REQ-003", commit: "activity:commit:688a992" },
      { req: "entity:req:REQ-004", commit: "activity:commit:688a992" },
    ]
  );

  // Verify PullRequests are modeled as collections of CommitActivity nodes via hadMember
  const prMemberRels = store
    .getRelations()
    .filter((r) => r.relationType === "hadMember" && r.subjectId.startsWith("entity:pr:"));
  assert.deepEqual(
    prMemberRels.map((r) => ({ pr: r.subjectId, commit: r.objectId })),
    [
      { pr: "entity:pr:10", commit: "activity:commit:8529bc9" },
      { pr: "entity:pr:11", commit: "activity:commit:7d0a0c3" },
      { pr: "entity:pr:12", commit: "activity:commit:80c1cef" },
    ]
  );

  // Verify prov:wasInvalidatedBy on closed Issues (#1, #2, #3) and merged PRs (#10, #11)
  const invalidationRels = store
    .getRelations()
    .filter((r) => r.relationType === "wasInvalidatedBy");
  assert.equal(invalidationRels.length, 5);
  const invalidatedSubjects = invalidationRels.map((r) => r.subjectId);
  assert.ok(invalidatedSubjects.includes("entity:issue:1"));
  assert.ok(invalidatedSubjects.includes("entity:issue:2"));
  assert.ok(invalidatedSubjects.includes("entity:issue:3"));
  assert.ok(!invalidatedSubjects.includes("entity:issue:4"), "Open issue #4 should not be invalidated");
  assert.ok(invalidatedSubjects.includes("entity:pr:10"));
  assert.ok(invalidatedSubjects.includes("entity:pr:11"));
  assert.ok(!invalidatedSubjects.includes("entity:pr:12"), "Open PR #12 should not be invalidated");

  const matrix = store.getRequirementsMatrix();
  const byCode = new Map(matrix.map((r) => [r.code, r]));

  assert.equal(byCode.get("REQ-001")?.compliant, true);
  assert.deepEqual(byCode.get("REQ-001")?.findings, []);
  assert.equal(byCode.get("REQ-001")?.codeCommits.length, 2);
  assert.equal(byCode.get("REQ-001")?.testCommits.length, 2);
  assert.equal(byCode.get("REQ-002")?.compliant, true);
  assert.equal(byCode.get("REQ-002")?.codeCommits.length, 2);
  assert.equal(byCode.get("REQ-002")?.testCommits.length, 2);
  assert.equal(byCode.get("REQ-003")?.compliant, false);
  assert.equal(byCode.get("REQ-003")?.codeCommits.length, 1);
  assert.equal(byCode.get("REQ-003")?.testCommits.length, 0);
  assert.deepEqual(
    byCode.get("REQ-003")?.findings.map((f) => f.ruleId),
    ["GOV-003"]
  );
  assert.equal(byCode.get("REQ-004")?.compliant, false);
  assert.equal(byCode.get("REQ-004")?.codeCommits.length, 0);
  assert.deepEqual(
    byCode.get("REQ-004")?.findings.map((f) => f.ruleId),
    ["GOV-002"]
  );

  const anomalies = store.getProcessAnomalies();
  assert.equal(GOVERNANCE_RULES.length, 4);
  assert.deepEqual(
    GOVERNANCE_RULES.map((r) => ({ id: r.id, category: r.category, severity: r.severity })),
    [
      { id: "GOV-001", category: "Untracked Work", severity: "high" },
      { id: "GOV-002", category: "Unimplemented Spec", severity: "medium" },
      { id: "GOV-003", category: "Missing Test Coverage", severity: "medium" },
      { id: "GOV-004", category: "Four-Eyes Review", severity: "high" },
    ],
    "Rule metadata should be loaded from OPA Rego catalog"
  );
  assert.deepEqual(
    anomalies.map((a) => a.ruleId),
    ["GOV-001", "GOV-002", "GOV-003", "GOV-004"]
  );
  const subsetAnomalies = store.getProcessAnomalies([GOVERNANCE_RULES[0], GOVERNANCE_RULES[3]]);
  assert.deepEqual(
    subsetAnomalies.map((a) => a.ruleId),
    ["GOV-001", "GOV-004"],
    "Individual OPA-backed GovernanceRule.evaluate() calls should filter by rule ID"
  );
  const categories = anomalies.map((a) => a.category);
  assert.ok(categories.includes("Untracked Work"), "Should detect untracked CLI commit");
  assert.ok(categories.includes("Unimplemented Spec"), "Should detect unimplemented REQ-004");
  assert.ok(categories.includes("Missing Test Coverage"), "Should detect untested REQ-003");
  assert.ok(categories.includes("Four-Eyes Review"), "Should detect self-reviewed PR #11");
  assert.equal(
    anomalies.find((a) => a.ruleId === "GOV-004")?.nodeId,
    "entity:pr:11",
    "PR #11 should be flagged for self-review while PR #10 (reviewed by carol-qa) passes"
  );

  // Verify same agent can hold multiple qualified prov:Association roles (author + reviewer on PR #11)
  const pr11Assocs = store
    .getRelations()
    .filter(
      (r) => r.relationType === "wasAssociatedWith" && r.subjectId === "activity:pr-review:11"
    );
  assert.deepEqual(
    pr11Assocs.map((r) => r.role).sort(),
    ["author", "reviewer"]
  );

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
  assert.match(focusHtml, /Showing 1-hop PROV neighborhood around entity:req:REQ-001/);
  assert.match(focusHtml, /Outgoing PROV Relations/);

  const lineageRes = await app.request("/api/focus?id=entity%3Areq%3AREQ-001&mode=lineage");
  assert.equal(lineageRes.status, 200);
  const lineageHtml = await lineageRes.text();
  assert.match(lineageHtml, /Showing upstream &amp; downstream causal lineage for entity:req:REQ-001/);

  const hop1Graph = store.getGraphData("entity:req:REQ-001", "1hop");
  const lineageGraph = store.getGraphData("entity:req:REQ-001", "lineage");
  assert.equal(hop1Graph.nodes.length, 7, "1-hop focus around REQ-001 should have 7 direct neighbor nodes");
  assert.equal(lineageGraph.nodes.length, 9, "Full lineage for REQ-001 should include PRs #10 and #11");
  assert.ok(
    !lineageGraph.nodes.some((n) => n.id === "entity:req:REQ-003" || n.id === "entity:req:REQ-004"),
    "Full lineage for REQ-001 must not fan out to unrelated sibling requirements"
  );

  const provRes = await app.request("/api/prov.json");
  assert.equal(provRes.status, 200);
  const provDoc = (await provRes.json()) as Record<string, unknown>;
  assert.ok(provDoc.entity);
  assert.ok(provDoc.wasDerivedFrom);
  assert.ok(provDoc.hadMember);
  assert.ok(provDoc.wasInvalidatedBy);
});

test("Read-only mode disables pipeline mutations and SSE while preserving graph exploration", async () => {
  const store = new ProvStore(":memory:");
  const pipeline = new ExtractionPipeline(store);
  await pipeline.runAllLoaders(0);

  const app = createApp(store, pipeline, { readOnly: true });

  const healthRes = await app.request("/healthz");
  assert.equal(healthRes.status, 200);
  assert.deepEqual(await healthRes.json(), {
    status: "ok",
    readOnly: true,
    authEnabled: false,
  });

  const homeRes = await app.request("/");
  assert.equal(homeRes.status, 200);
  const html = await homeRes.text();
  assert.match(html, /Read-Only Preview/);
  assert.match(html, /Read-Only Demo Snapshot/);
  assert.doesNotMatch(html, /Run Full Pipeline/);
  assert.doesNotMatch(html, /Reset Store/);
  assert.doesNotMatch(html, /\/api\/stream/);

  assert.equal((await app.request("/api/loaders/run-all", { method: "POST" })).status, 403);
  assert.equal(
    (await app.request("/api/loaders/run?loader=git-commits", { method: "POST" })).status,
    403
  );
  assert.equal((await app.request("/api/loaders/reset", { method: "POST" })).status, 403);
  assert.equal((await app.request("/api/stream")).status, 403);

  // Interactive exploration & PROV-JSON export remain fully accessible
  assert.equal((await app.request("/api/focus?id=entity%3Areq%3AREQ-001")).status, 200);
  assert.equal((await app.request("/api/prov.json")).status, 200);
});

test("Google OAuth + allowlist middleware enforces screened reviewer access", async () => {
  assert.throws(
    () =>
      loadAuthConfigFromEnv({
        GOOGLE_CLIENT_ID: "client-id-only",
      }),
    /required environment variables are missing/
  );

  const store = new ProvStore(":memory:");
  const pipeline = new ExtractionPipeline(store);
  await pipeline.runAllLoaders(0);

  const allowedEmails = new Set(["reviewer@example.com"]);
  let nextMockUser = {
    email: "uninvited@example.com",
    email_verified: true,
    name: "Uninvited User",
  };

  const authConfig: AuthConfig = {
    enabled: true,
    googleClientId: "test-client-id.apps.googleusercontent.com",
    googleClientSecret: "test-client-secret",
    sessionSecret: "0123456789abcdef0123456789abcdef",
    allowedEmails,
    publicBaseUrl: "https://provtrace.example.com",
    exchangeCodeForUser: async () => nextMockUser,
  };

  const app = createApp(store, pipeline, { readOnly: true, auth: authConfig });

  // Health check stays public for Cloud Run probes
  assert.equal((await app.request("/healthz")).status, 200);

  // Unauthenticated requests are redirected (HTML) or rejected with 401 (API)
  const unauthHome = await app.request("/");
  assert.equal(unauthHome.status, 302);
  assert.equal(unauthHome.headers.get("location"), "/auth/signin?returnTo=%2F");

  const unauthApi = await app.request("/api/prov.json");
  assert.equal(unauthApi.status, 401);

  const signInRes = await app.request("/auth/signin");
  assert.equal(signInRes.status, 200);
  assert.match(await signInRes.text(), /Sign in with Google/);

  // Step 1: /auth/login redirects to Google OAuth with PKCE + state cookie
  const loginRes = await app.request("/auth/login?returnTo=%2F%3Ffocus%3Dentity%3Areq%3AREQ-001");
  assert.equal(loginRes.status, 302);
  const googleRedirect = new URL(loginRes.headers.get("location")!);
  assert.equal(googleRedirect.origin, "https://accounts.google.com");
  assert.equal(googleRedirect.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    googleRedirect.searchParams.get("redirect_uri"),
    "https://provtrace.example.com/auth/callback"
  );
  const stateParam = googleRedirect.searchParams.get("state")!;
  const stateCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  // Step 2a: Non-allowlisted Google user is denied with 403
  const deniedRes = await app.request(`/auth/callback?code=mock-code&state=${stateParam}`, {
    headers: { Cookie: stateCookie },
  });
  assert.equal(deniedRes.status, 403);
  assert.match(await deniedRes.text(), /Access Restricted/);

  // Step 2b: Allowlisted Google user succeeds and receives signed HttpOnly session cookie
  nextMockUser = {
    email: "Reviewer@Example.com",
    email_verified: true,
    name: "Screened Reviewer",
  };
  const loginRes2 = await app.request("/auth/login?returnTo=%2F");
  const stateParam2 = new URL(loginRes2.headers.get("location")!).searchParams.get("state")!;
  const stateCookie2 = loginRes2.headers.get("set-cookie")!.split(";")[0];

  const okCallback = await app.request(`/auth/callback?code=mock-code&state=${stateParam2}`, {
    headers: { Cookie: stateCookie2 },
  });
  assert.equal(okCallback.status, 302);
  assert.equal(okCallback.headers.get("location"), "/");
  const setCookies = okCallback.headers.getSetCookie();
  const sessionCookieHeader = setCookies.find((c) => c.startsWith("provtrace_session="))!;
  assert.ok(sessionCookieHeader, "Callback must set provtrace_session cookie");
  assert.match(sessionCookieHeader, /HttpOnly/i);
  assert.match(sessionCookieHeader, /Secure/i);
  const sessionCookie = sessionCookieHeader.split(";")[0];

  // Step 3: Authenticated reviewer can access UI and API
  const authedHome = await app.request("/", { headers: { Cookie: sessionCookie } });
  assert.equal(authedHome.status, 200);
  const authedHtml = await authedHome.text();
  assert.match(authedHtml, /reviewer@example\.com/);
  assert.match(authedHtml, /Sign out/);

  const authedApi = await app.request("/api/prov.json", { headers: { Cookie: sessionCookie } });
  assert.equal(authedApi.status, 200);

  // Step 4: Removing email from allowlist immediately revokes access
  allowedEmails.delete("reviewer@example.com");
  const revokedApi = await app.request("/api/prov.json", { headers: { Cookie: sessionCookie } });
  assert.equal(revokedApi.status, 401);

  // Step 5: Logout clears session cookie and redirects to sign-in
  const logoutRes = await app.request("/auth/logout", {
    method: "POST",
    headers: { Cookie: sessionCookie },
  });
  assert.equal(logoutRes.status, 302);
  assert.equal(logoutRes.headers.get("location"), "/auth/signin");
});
