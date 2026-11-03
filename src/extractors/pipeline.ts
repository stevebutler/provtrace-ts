import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { seedTargetRepo } from "../../scripts/seed-target-repo.js";
import type { ProvStore } from "../db/store.js";
import type { LoaderName } from "../prov/types.js";
import { runAsciiDocExtractor } from "./asciidoc-extractor.js";
import { runGitExtractor } from "./git-extractor.js";
import { runGitHubExtractor } from "./github-extractor.js";
import { runProvLinker } from "./prov-linker.js";

export class ExtractionPipeline extends EventEmitter {
  private running = false;

  constructor(
    readonly store: ProvStore,
    readonly repoDir = path.resolve(process.cwd(), "target-project"),
    readonly fixtureFile = path.resolve(process.cwd(), "fixtures/github.json")
  ) {
    super();
  }

  get isRunning() {
    return this.running;
  }

  ensureTargetRepo() {
    if (!existsSync(path.join(this.repoDir, ".git"))) {
      seedTargetRepo(this.repoDir);
      this.store.appendLog("system", "info", "Initialized sample Python Git repository (pyledger)");
    }
  }

  async runSingleLoader(loaderName: LoaderName, stepDelayMs = 200) {
    if (this.running) {
      this.store.appendLog(loaderName, "warn", "Another extraction pipeline job is already active.");
      this.emit("update");
      return;
    }

    this.running = true;
    try {
      this.ensureTargetRepo();
      await this.executeLoader(loaderName, stepDelayMs);
    } finally {
      this.running = false;
      this.emit("update", { fullRefresh: true });
    }
  }

  async runAllLoaders(stepDelayMs = 180) {
    if (this.running) {
      this.store.appendLog("pipeline", "warn", "Extraction pipeline is already running.");
      this.emit("update");
      return;
    }

    this.running = true;
    try {
      this.ensureTargetRepo();
      this.store.appendLog("pipeline", "info", "Starting full W3C PROV extraction pipeline...");
      this.emit("update");

      const sequence: LoaderName[] = [
        "git-commits",
        "asciidoc-specs",
        "github-issues",
        "prov-linker",
      ];

      for (const loader of sequence) {
        await this.executeLoader(loader, stepDelayMs);
      }

      this.store.appendLog("pipeline", "info", "All extractors and PROV linker finished cleanly.");
    } finally {
      this.running = false;
      this.emit("update", { fullRefresh: true });
    }
  }

  private async executeLoader(loaderName: LoaderName, stepDelayMs: number) {
    const startedAt = new Date().toISOString();
    this.store.updateLoaderStatus(loaderName, {
      status: "running",
      progressPct: 5,
      itemsProcessed: 0,
      relationsCreated: 0,
      startedAt,
      finishedAt: null,
      message: "Starting extraction...",
      error: null,
    });
    this.store.appendLog(loaderName, "info", `Started ${loaderName}`);
    this.emit("update");

    const runnerMap = {
      "git-commits": runGitExtractor,
      "asciidoc-specs": runAsciiDocExtractor,
      "github-issues": runGitHubExtractor,
      "prov-linker": runProvLinker,
    } as const;

    try {
      const result = await runnerMap[loaderName]({
        store: this.store,
        repoDir: this.repoDir,
        fixtureFile: this.fixtureFile,
        stepDelayMs,
        onStep: ({ progressPct, itemsProcessed, relationsCreated, message }) => {
          this.store.updateLoaderStatus(loaderName, {
            status: "running",
            progressPct,
            itemsProcessed,
            relationsCreated,
            message,
          });
          this.store.appendLog(loaderName, "info", message);
          this.emit("update");
        },
      });

      this.store.updateLoaderStatus(loaderName, {
        status: "completed",
        progressPct: 100,
        itemsProcessed: result.itemsProcessed,
        relationsCreated: result.relationsCreated,
        finishedAt: new Date().toISOString(),
        message: `Completed: ${result.itemsProcessed} records, ${result.relationsCreated} PROV relations`,
        error: null,
      });
      this.emit("update", { fullRefresh: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.updateLoaderStatus(loaderName, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        message: "Extraction failed",
        error: msg,
      });
      this.store.appendLog(loaderName, "error", msg);
      this.emit("update", { fullRefresh: true });
      throw err;
    }
  }
}
