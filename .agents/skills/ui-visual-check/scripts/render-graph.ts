import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ProvStore } from "../../../../src/db/store.js";
import { ExtractionPipeline } from "../../../../src/extractors/pipeline.js";
import { createApp } from "../../../../src/index.js";

const outDir = "/tmp/provtrace-visual-check";
fs.mkdirSync(outDir, { recursive: true });

const store = new ProvStore();
const pipeline = new ExtractionPipeline(store);
if (store.getSummaryStats().entities === 0) {
  await pipeline.runAllLoaders(0);
}

const app = createApp(store, pipeline);
const targets = process.argv.slice(2);
const focusIds = targets.length > 0 ? targets : ["entity:req:REQ-001"];

const views: Array<{ name: string; url: string }> = [{ name: "overview", url: "/" }];
for (const id of focusIds) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  views.push({ name: `${safe}-1hop`, url: `/?focus=${encodeURIComponent(id)}&mode=1hop` });
  views.push({ name: `${safe}-lineage`, url: `/?focus=${encodeURIComponent(id)}&mode=lineage` });
}

for (const view of views) {
  const res = await app.request(view.url);
  const html = await res.text();
  const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/);
  if (!svgMatch) continue;

  const standaloneSvg = svgMatch[0]
    .replace(/ data-on:click="[^"]*"/g, "")
    .replace(
      "<svg ",
      '<svg xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;color:#0f172a;font-family:sans-serif;" '
    )
    .replaceAll("var(--prov-entity-fill)", "#fffbeb")
    .replaceAll("var(--prov-entity-stroke)", "#d97706")
    .replaceAll("var(--prov-activity-fill)", "#eff6ff")
    .replaceAll("var(--prov-activity-stroke)", "#2563eb")
    .replaceAll("var(--prov-agent-fill)", "#fff7ed")
    .replaceAll("var(--prov-agent-stroke)", "#ea580c")
    .replaceAll("var(--brand)", "#4f46e5");

  const svgPath = path.join(outDir, `${view.name}.svg`);
  const pngPath = path.join(outDir, `${view.name}.png`);
  fs.writeFileSync(svgPath, standaloneSvg);
  execFileSync("magick", [svgPath, pngPath]);
  console.log(`Rendered ${pngPath}`);
}
