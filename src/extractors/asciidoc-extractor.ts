import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtractorContext } from "./git-extractor.js";

interface ParsedRequirement {
  code: string;
  title: string;
  status: string;
  sourceRefs: string[];
  description: string;
  filePath: string;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function parseAsciiDocRequirements(content: string, relFilePath: string): ParsedRequirement[] {
  const lines = content.split(/\r?\n/);
  const results: ParsedRequirement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const anchorMatch = lines[i].trim().match(/^\[\[(REQ-\d+)\]\]$/);
    if (!anchorMatch) continue;

    const code = anchorMatch[1];
    let title = code;
    let cursor = i + 1;

    if (cursor < lines.length && lines[cursor].startsWith("==")) {
      title = lines[cursor]
        .replace(/^=+\s*/, "")
        .replace(new RegExp(`^${code}:\\s*`), "")
        .trim();
      cursor++;
    }

    let status = "Draft";
    const sourceRefs: string[] = [];
    const descLines: string[] = [];

    while (cursor < lines.length && !lines[cursor].trim().startsWith("[[") && !lines[cursor].startsWith("==")) {
      const line = lines[cursor].trim();
      if (line.includes("*Status*:")) {
        const statusMatch = line.match(/\*Status\*:\s*([^|]+)/);
        if (statusMatch) status = statusMatch[1].trim();
        for (const issueMatch of line.matchAll(/(?:issue#|#)(\d+)/gi)) {
          sourceRefs.push(issueMatch[1]);
        }
      } else if (line.length > 0) {
        descLines.push(line);
        for (const issueMatch of line.matchAll(/(?:issue#|#)(\d+)/gi)) {
          sourceRefs.push(issueMatch[1]);
        }
      }
      cursor++;
    }

    results.push({
      code,
      title,
      status,
      sourceRefs: [...new Set(sourceRefs)],
      description: descLines.join(" "),
      filePath: relFilePath,
    });
  }

  return results;
}

function findIntroducingDocsCommit(
  repoDir: string,
  relPath: string,
  reqCode: string
): { shortSha: string; authorIso: string } | null {
  try {
    const out = execFileSync(
      "git",
      ["log", "-S", `[[${reqCode}]]`, "--reverse", "--format=%h%x1f%aI", "--", relPath],
      { cwd: repoDir, encoding: "utf8" }
    ).trim();
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    if (!firstLine) return null;
    const [shortSha, authorIso] = firstLine.split("\x1f");
    return shortSha ? { shortSha, authorIso: authorIso ?? "" } : null;
  } catch {
    return null;
  }
}

export async function runAsciiDocExtractor(ctx: ExtractorContext) {
  const { store, repoDir, stepDelayMs = 0, onStep } = ctx;
  const docsDir = path.join(repoDir, "docs");
  if (!existsSync(docsDir)) {
    return { itemsProcessed: 0, relationsCreated: 0 };
  }

  const adocFiles = readdirSync(docsDir).filter((f) => f.endsWith(".adoc"));

  let items = 0;
  let relations = 0;

  for (const fileName of adocFiles) {
    const relPath = `docs/${fileName}`;
    const content = readFileSync(path.join(docsDir, fileName), "utf8");
    const parsedReqs = parseAsciiDocRequirements(content, relPath);

    for (let idx = 0; idx < parsedReqs.length; idx++) {
      const req = parsedReqs[idx];
      const reqEntityId = `entity:req:${req.code}`;
      const authoringCommit = findIntroducingDocsCommit(repoDir, relPath, req.code);

      store.upsertEntity({
        id: reqEntityId,
        entityType: "Requirement",
        label: `${req.code}: ${req.title}`,
        source: "asciidoc",
        createdAt: authoringCommit?.authorIso || null,
        attributes: {
          code: req.code,
          title: req.title,
          status: req.status,
          description: req.description,
          sourceRefs: req.sourceRefs,
          documentPath: relPath,
          ...(authoringCommit ? { introducedInCommit: authoringCommit.shortSha } : {}),
        },
      });
      items++;

      if (authoringCommit) {
        const commitActivityId = `activity:commit:${authoringCommit.shortSha}`;
        if (store.getActivityById(commitActivityId)) {
          store.addRelation({
            relationType: "wasGeneratedBy",
            subjectId: reqEntityId,
            objectId: commitActivityId,
            attributes: {},
          });
          relations++;
        }
      }

      const pct = Math.round(((idx + 1) / Math.max(parsedReqs.length, 1)) * 100);
      await onStep?.({
        progressPct: pct,
        itemsProcessed: items,
        relationsCreated: relations,
        message: `Extracted AsciiDoc requirement ${req.code} (${req.status}) from ${relPath}`,
      });
      await sleep(stepDelayMs);
    }
  }

  return { itemsProcessed: items, relationsCreated: relations };
}
