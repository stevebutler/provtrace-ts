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

export async function runAsciiDocExtractor(ctx: ExtractorContext) {
  const { store, repoDir, stepDelayMs = 0, onStep } = ctx;
  const docsDir = path.join(repoDir, "docs");
  if (!existsSync(docsDir)) {
    return { itemsProcessed: 0, relationsCreated: 0 };
  }

  const adocFiles = readdirSync(docsDir).filter((f) => f.endsWith(".adoc"));
  const docRevisions = store.getEntities("DocumentRevision");

  let items = 0;
  let relations = 0;

  for (const fileName of adocFiles) {
    const relPath = `docs/${fileName}`;
    const content = readFileSync(path.join(docsDir, fileName), "utf8");
    const parsedReqs = parseAsciiDocRequirements(content, relPath);

    // Find the latest DocumentRevision in Git for this AsciiDoc file
    const matchingRevs = docRevisions.filter((d) => d.attributes.path === relPath);
    const latestDocRev = matchingRevs.at(-1) ?? null;

    for (let idx = 0; idx < parsedReqs.length; idx++) {
      const req = parsedReqs[idx];
      const reqEntityId = `entity:req:${req.code}`;

      store.upsertEntity({
        id: reqEntityId,
        entityType: "Requirement",
        label: `${req.code}: ${req.title}`,
        source: "asciidoc",
        createdAt: latestDocRev?.createdAt ?? null,
        attributes: {
          code: req.code,
          title: req.title,
          status: req.status,
          description: req.description,
          sourceRefs: req.sourceRefs,
          documentPath: relPath,
        },
      });
      items++;

      if (latestDocRev) {
        store.addRelation({
          relationType: "hadMember",
          subjectId: latestDocRev.id,
          objectId: reqEntityId,
          role: "prov:Collection",
          attributes: {},
        });
        relations++;
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
