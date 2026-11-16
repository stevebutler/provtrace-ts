import { execFileSync } from "node:child_process";
import type { ProvStore } from "../db/store.js";
import type { CommitCategory } from "../prov/types.js";

export interface ExtractorContext {
  store: ProvStore;
  repoDir: string;
  fixtureFile: string;
  stepDelayMs?: number;
  onStep?: (info: {
    progressPct: number;
    itemsProcessed: number;
    relationsCreated: number;
    message: string;
  }) => Promise<void> | void;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const CATEGORY_ORDER: readonly CommitCategory[] = ["code", "tests", "docs", "config"];

export function classifyFileCategory(filePath: string): CommitCategory {
  if (
    filePath.startsWith("docs/") ||
    filePath.endsWith(".adoc") ||
    filePath.endsWith(".md") ||
    filePath.endsWith(".txt")
  ) {
    return "docs";
  }
  if (filePath.startsWith("tests/") || filePath.includes("test_")) {
    return "tests";
  }
  if (filePath.startsWith("src/") && !filePath.endsWith("__init__.py")) {
    return "code";
  }
  return "config";
}

export function classifyCommitCategories(filePaths: string[]): CommitCategory[] {
  const seen = new Set<CommitCategory>();
  for (const fp of filePaths) {
    seen.add(classifyFileCategory(fp));
  }
  return CATEGORY_ORDER.filter((cat) => seen.has(cat));
}

export async function runGitExtractor(ctx: ExtractorContext) {
  const { store, repoDir, stepDelayMs = 0, onStep } = ctx;

  // Format: sha | shortSha | parentShort | authorName | authorEmail | authorIso | subject | body
  const rawLog = execFileSync(
    "git",
    [
      "log",
      "--reverse",
      "--format=%H%x1f%h%x1f%p%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e",
    ],
    { cwd: repoDir, encoding: "utf8" }
  );

  const rawCommits = rawLog
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean);

  let items = 0;
  let relations = 0;

  for (let i = 0; i < rawCommits.length; i++) {
    const parts = rawCommits[i].split("\x1f");
    const [sha, shortSha, parentShorts, authorName, authorEmail, authorIso, subject, body = ""] =
      parts;

    const statusOutput = execFileSync(
      "git",
      ["show", "--pretty=format:", "--name-status", sha],
      { cwd: repoDir, encoding: "utf8" }
    );
    const fileChanges = statusOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const lineParts = line.split("\t");
        const status = lineParts[0] ?? "M";
        if (status.startsWith("R")) {
          return { status: "R", oldPath: lineParts[1] ?? "", filePath: lineParts[2] ?? "" };
        }
        return { status: status[0] ?? "M", oldPath: null, filePath: lineParts[1] ?? "" };
      })
      .filter((entry) => Boolean(entry.filePath));

    const files = fileChanges.filter((fc) => fc.status !== "D").map((fc) => fc.filePath);
    const deletedFiles = fileChanges.filter((fc) => fc.status === "D").map((fc) => fc.filePath);
    const allTouchedPaths = fileChanges.map((fc) => fc.filePath);
    const categories = classifyCommitCategories(files.length > 0 ? files : allTouchedPaths);

    const agentId = `agent:git:${authorEmail.toLowerCase()}`;
    store.upsertAgent({
      id: agentId,
      agentType: "Person",
      label: `${authorName} <${authorEmail}>`,
      attributes: {
        name: authorName,
        email: authorEmail.toLowerCase(),
      },
    });

    const activityId = `activity:commit:${shortSha}`;
    store.upsertActivity({
      id: activityId,
      activityType: "CommitActivity",
      label: `${shortSha}: ${subject}`,
      source: "git-repo",
      startedAt: authorIso,
      endedAt: authorIso,
      attributes: {
        sha,
        shortSha,
        subject,
        body: body.trim(),
        fullMessage: `${subject}\n${body}`.trim(),
        authorEmail: authorEmail.toLowerCase(),
        categories,
        files,
        deletedFiles,
        filesCount: files.length,
      },
    });
    items++;

    store.addRelation({
      relationType: "wasAssociatedWith",
      subjectId: activityId,
      objectId: agentId,
      role: "author",
      attributes: {},
    });
    relations++;

    // Parent commit control-flow link (Activity -> Activity)
    for (const parentShort of parentShorts.split(" ").map((p) => p.trim()).filter(Boolean)) {
      store.addRelation({
        relationType: "wasInformedBy",
        subjectId: activityId,
        objectId: `activity:commit:${parentShort}`,
        role: "git:parentCommit",
        attributes: {},
      });
      relations++;
    }

    const pct = Math.round(((i + 1) / rawCommits.length) * 100);
    await onStep?.({
      progressPct: pct,
      itemsProcessed: items,
      relationsCreated: relations,
      message: `Classified commit ${shortSha} [${categories.join(", ")}]: "${subject}"`,
    });
    await sleep(stepDelayMs);
  }

  return { itemsProcessed: items, relationsCreated: relations };
}
