import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ProvStore } from "./db/store.js";
import { ExtractionPipeline } from "./extractors/pipeline.js";
import type { LoaderName } from "./prov/types.js";
import {
  AppPage,
  ExplorerSection,
  KpiSection,
  LoadersSection,
  ReportsSection,
} from "./web/components.js";
import { formatDatastarPatchElements } from "./web/sse.js";

export function createApp(store = new ProvStore(), pipeline = new ExtractionPipeline(store)) {
  const app = new Hono();
  const datastarJsPath = path.resolve(process.cwd(), "public/datastar.js");

  app.get("/public/datastar.js", (c) => {
    const js = readFileSync(datastarJsPath, "utf8");
    return c.body(js, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });

  app.get("/", (c) => {
    const focusId = c.req.query("focus") || undefined;
    return c.html(
      `<!DOCTYPE html>${(<AppPage store={store} isRunning={pipeline.isRunning} focusId={focusId} />).toString()}`
    );
  });

  // Persistent Datastar SSE stream for live loader progress and dashboard updates
  app.get("/api/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });

      const pushDashboardUpdate = async (opts?: { fullRefresh?: boolean }) => {
        if (closed) return;
        const loadersHtml = (
          <LoadersSection store={store} isRunning={pipeline.isRunning} />
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
    const html = (<ExplorerSection store={store} focusId={id} />).toString();
    return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
  });

  // Trigger full extraction pipeline asynchronously (progress streams via /api/stream)
  app.post("/api/loaders/run-all", (c) => {
    void pipeline.runAllLoaders(220);
    const loadersHtml = (<LoadersSection store={store} isRunning={true} />).toString();
    return c.body(loadersHtml, 200, { "Content-Type": "text/html; charset=utf-8" });
  });

  // Trigger a single loader asynchronously
  app.post("/api/loaders/run", (c) => {
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
  const app = createApp(store, pipeline);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`ProvTrace web app listening on http://localhost:${info.port}`);
  });
}
