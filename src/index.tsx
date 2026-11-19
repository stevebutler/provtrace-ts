import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ProvStore } from "./db/store.js";
import { ExtractionPipeline } from "./extractors/pipeline.js";
import type { GraphFocusMode, LoaderName } from "./prov/types.js";
import {
  type AuthConfig,
  createAuthMiddleware,
  getAuthenticatedUser,
  loadAuthConfigFromEnv,
  registerAuthRoutes,
} from "./web/auth.js";
import {
  AppPage,
  ExplorerSection,
  KpiSection,
  LoadersSection,
  ReportsSection,
} from "./web/components.js";
import { formatDatastarPatchElements } from "./web/sse.js";

export interface AppOptions {
  readOnly?: boolean;
  auth?: AuthConfig;
}

export function createApp(
  store = new ProvStore(),
  pipeline = new ExtractionPipeline(store),
  options: AppOptions = {}
) {
  const readOnly = options.readOnly ?? process.env.READ_ONLY_MODE === "true";
  const authConfig = options.auth ?? loadAuthConfigFromEnv();

  const app = new Hono();
  const datastarJsPath = path.resolve(process.cwd(), "public/datastar.js");

  // Health check endpoint (always accessible for Cloud Run startup/liveness probes)
  app.get("/healthz", (c) => {
    return c.json({
      status: "ok",
      readOnly,
      authEnabled: authConfig.enabled,
    });
  });

  // Google OAuth sign-in, callback, logout routes & allowlist middleware
  registerAuthRoutes(app, authConfig);
  app.use("*", createAuthMiddleware(authConfig));

  app.get("/public/datastar.js", (c) => {
    const js = readFileSync(datastarJsPath, "utf8");
    return c.body(js, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });

  app.get("/", (c) => {
    const focusId = c.req.query("focus") || undefined;
    const focusMode: GraphFocusMode = c.req.query("mode") === "lineage" ? "lineage" : "1hop";
    const currentUser = getAuthenticatedUser(c, authConfig);
    return c.html(
      `<!DOCTYPE html>${(
        <AppPage
          store={store}
          isRunning={pipeline.isRunning}
          focusId={focusId}
          focusMode={focusMode}
          readOnly={readOnly}
          currentUser={currentUser}
        />
      ).toString()}`
    );
  });

  // Persistent Datastar SSE stream for live loader progress and dashboard updates
  app.get("/api/stream", (c) => {
    if (readOnly) {
      return c.text("SSE stream disabled in read-only mode", 403);
    }
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });

      const pushDashboardUpdate = async (opts?: { fullRefresh?: boolean }) => {
        if (closed) return;
        const loadersHtml = (
          <LoadersSection store={store} isRunning={pipeline.isRunning} readOnly={readOnly} />
        ).toString();
        await stream.writeSSE(formatDatastarPatchElements(loadersHtml));

        if (opts?.fullRefresh) {
          const kpiHtml = (<KpiSection store={store} />).toString();
          const explorerHtml = (<ExplorerSection store={store} />).toString();
          const reportsHtml = (<ReportsSection store={store} />).toString();
          await stream.writeSSE(formatDatastarPatchElements(kpiHtml));
          await stream.writeSSE(formatDatastarPatchElements(explorerHtml));
          await stream.writeSSE(formatDatastarPatchElements(reportsHtml));
        }
      };

      const onUpdate = (opts?: { fullRefresh?: boolean }) => {
        void pushDashboardUpdate(opts);
      };

      pipeline.on("update", onUpdate);
      try {
        // Send initial sync snapshot
        await pushDashboardUpdate({ fullRefresh: false });
        while (!closed) {
          await stream.sleep(15000);
        }
      } finally {
        pipeline.off("update", onUpdate);
      }
    });
  });

  // Interactive graph focus & node inspector patch
  app.get("/api/focus", (c) => {
    const id = c.req.query("id") || undefined;
    const mode: GraphFocusMode = c.req.query("mode") === "lineage" ? "lineage" : "1hop";
    const html = (<ExplorerSection store={store} focusId={id} focusMode={mode} />).toString();
    return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
  });

  // Trigger full extraction pipeline asynchronously (progress streams via /api/stream)
  app.post("/api/loaders/run-all", (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode: pipeline mutations are disabled." }, 403);
    }
    void pipeline.runAllLoaders(220);
    const loadersHtml = (<LoadersSection store={store} isRunning={true} />).toString();
    return c.body(loadersHtml, 200, { "Content-Type": "text/html; charset=utf-8" });
  });

  // Trigger a single loader asynchronously
  app.post("/api/loaders/run", (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode: pipeline mutations are disabled." }, 403);
    }
    const loader = c.req.query("loader") as LoaderName | undefined;
    const valid: LoaderName[] = [
      "git-commits",
      "asciidoc-specs",
      "github-issues",
      "prov-linker",
    ];
    if (!loader || !valid.includes(loader)) {
      return c.text("Invalid loader name", 400);
    }
    void pipeline.runSingleLoader(loader, 220);
    const loadersHtml = (<LoadersSection store={store} isRunning={true} />).toString();
    return c.body(loadersHtml, 200, { "Content-Type": "text/html; charset=utf-8" });
  });

  // Reset database & broadcast empty state
  app.post("/api/loaders/reset", (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode: store reset is disabled." }, 403);
    }
    if (!pipeline.isRunning) {
      store.resetAllData();
      store.appendLog("system", "info", "Reset SQLite PROV database.");
      pipeline.emit("update", { fullRefresh: true });
    }
    return streamSSE(c, async (stream) => {
      await stream.writeSSE(
        formatDatastarPatchElements(
          (<LoadersSection store={store} isRunning={pipeline.isRunning} />).toString()
        )
      );
      await stream.writeSSE(formatDatastarPatchElements((<KpiSection store={store} />).toString()));
      await stream.writeSSE(
        formatDatastarPatchElements((<ExplorerSection store={store} />).toString())
      );
      await stream.writeSSE(
        formatDatastarPatchElements((<ReportsSection store={store} />).toString())
      );
    });
  });

  // Standard W3C PROV-JSON export endpoint
  app.get("/api/prov.json", (c) => {
    return c.json(store.exportProvJson());
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const store = new ProvStore();
  const pipeline = new ExtractionPipeline(store);

  // Populate initial dataset on first launch so the UI opens with live provenance data
  if (store.getSummaryStats().entities === 0) {
    await pipeline.runAllLoaders(0);
  }

  const port = Number(process.env.PORT ?? 3000);
  const hostname = process.env.HOST ?? "0.0.0.0";
  const app = createApp(store, pipeline);

  serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.log(`ProvTrace web app listening on http://${info.address}:${info.port}`);
  });
}
