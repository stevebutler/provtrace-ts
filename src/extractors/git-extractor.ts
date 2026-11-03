import { execFileSync } from "node:child_process";
import type { ProvStore } from "../db/store.js";
import type { EntityType } from "../prov/types.js";

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

function classifyPath(filePath: string): EntityType {
  if (filePath.startsWith("docs/") || filePath.endsWith(".adoc")) {
    return "DocumentRevision";
  }
  if (filePath.startsWith("tests/") || filePath.includes("test_")) {
    return "TestArtifact";
  }
  return "CodeArtifact";
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
  const previousFileRevision = new Map<string, string>();

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
        const parts = line.split("\t");
        const status = parts[0] ?? "M";
        if (status.startsWith("R")) {
          return { status: "R", oldPath: parts[1] ?? "", filePath: parts[2] ?? "" };
        }
        return { status: status[0] ?? "M", oldPath: null, filePath: parts[1] ?? "" };
      })
      .filter((entry) => Boolean(entry.filePath));
    const files = fileChanges.filter((fc) => fc.status !== "D").map((fc) => fc.filePath);

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
        files,
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

    // File-level artifact entities generated or invalidated by this CommitActivity
    for (const change of fileChanges) {
      if (change.status === "D") {
        const prevFileId = previousFileRevision.get(change.filePath);
        if (prevFileId) {
          store.addRelation({
            relationType: "wasInvalidatedBy",
            subjectId: prevFileId,
            objectId: activityId,
            role: "git:fileDeleted",
            attributes: { time: authorIso, path: change.filePath },
          });
          relations++;
          previousFileRevision.delete(change.filePath);
        }
        continue;
      }

      const filePath = change.filePath;
      const fileEntityType = classifyPath(filePath);
      const fileEntityId = `entity:file:${filePath}@${shortSha}`;
      store.upsertEntity({
        id: fileEntityId,
        entityType: fileEntityType,
        label: `${filePath} @ ${shortSha}`,
        source: "git-repo",
        createdAt: authorIso,
        attributes: {
          path: filePath,
          commitSha: sha,
          shortSha,
        },
      });
      items++;

      store.addRelation({
        relationType: "wasGeneratedBy",
        subjectId: fileEntityId,
        objectId: activityId,
        attributes: {},
      });
      store.addRelation({
        relationType: "wasAttributedTo",
        subjectId: fileEntityId,
        objectId: agentId,
        attributes: {},
      });
      relations += 2;

      const prevLookupPath = change.status === "R" && change.oldPath ? change.oldPath : filePath;
      const prevFileId = previousFileRevision.get(prevLookupPath);
      if (prevFileId) {
        if (change.status === "R" && change.oldPath) {
          store.addRelation({
            relationType: "wasInvalidatedBy",
            subjectId: prevFileId,
            objectId: activityId,
            role: "git:fileRenamed",
            attributes: { time: authorIso, oldPath: change.oldPath, newPath: filePath },
          });
          relations++;
          previousFileRevision.delete(change.oldPath);
        }
        store.addRelation({
          relationType: "wasRevisionOf",
          subjectId: fileEntityId,
          objectId: prevFileId,
          role: "prov:Revision",
          attributes: {},
        });
        store.addRelation({
          relationType: "used",
          subjectId: activityId,
          objectId: prevFileId,
          attributes: {},
        });
        relations += 2;
      }
      previousFileRevision.set(filePath, fileEntityId);
    }

    const pct = Math.round(((i + 1) / rawCommits.length) * 100);
    await onStep?.({
      progressPct: pct,
      itemsProcessed: items,
      relationsCreated: relations,
      message: `Processed commit activity ${shortSha} (${fileChanges.length} file changes): "${subject}"`,
    });
    await sleep(stepDelayMs);
  }

  return { itemsProcessed: items, relationsCreated: relations };
}
