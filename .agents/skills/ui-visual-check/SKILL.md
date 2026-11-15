---
name: ui-visual-check
description: >-
  Renders ProvTrace Hono web routes and W3C PROV SVG lineage graphs to PNG images
  for visual inspection inside the sandbox. Use this skill whenever modifying graph
  filtering, SVG layout, UI components, or extractors to visually verify the rendered
  output with read_file.
---

# ProvTrace UI & Graph Visual Check

Because ProvTrace renders its W3C PROV lineage graphs server-side as SVG inside Hono JSX responses, you can render any graph view (Overview, `1hop`, or `lineage`) to a PNG image inside the sandbox and inspect it visually with `read_file`.

## Steps

1. Run the helper script [render-graph.ts](./scripts/render-graph.ts) to render one or more focus views to PNG files in `/tmp/provtrace-visual-check/`:
   ```bash
   npx tsx .agents/skills/ui-visual-check/scripts/render-graph.ts
   ```
   Or pass specific focus node IDs as arguments:
   ```bash
   npx tsx .agents/skills/ui-visual-check/scripts/render-graph.ts entity:req:REQ-001 entity:issue:3
   ```

2. Call `read_file` on the generated `/tmp/provtrace-visual-check/*.png` files to visually inspect:
   - Swimlane column alignment and node counts
   - Edge routing (checking that multi-column edges arc cleanly without cutting through intermediate node labels)
   - Difference between `1hop` and `lineage` views
