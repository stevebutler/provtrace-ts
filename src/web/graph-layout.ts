import type { ProvGraphEdge, ProvGraphNode } from "../prov/types.js";

export interface PositionedNode extends ProvGraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
}

export interface PositionedEdge extends ProvGraphEdge {
  pathD: string;
  labelX: number;
  labelY: number;
}

export interface GraphLayoutResult {
  width: number;
  height: number;
  columns: Array<{ index: number; title: string; x: number }>;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
}

function getColumnForNode(node: ProvGraphNode): number {
  if (node.kind === "agent") return 0;
  if (node.kind === "activity") {
    if (node.subType === "IssueReport" || node.subType === "IssueResolution") return 1;
    return 3;
  }
  switch (node.subType) {
    case "Issue":
    case "Bug":
      return 0;
    case "DocumentRevision":
    case "Requirement":
      return 1;
    case "PullRequest":
      return 2;
    case "Commit":
      return 3;
    case "CodeArtifact":
    case "TestArtifact":
    default:
      return 4;
  }
}

const COLUMN_TITLES: Record<number, string> = {
  0: "Issues & Agents",
  1: "Specs & Requirements",
  2: "Pull Requests",
  3: "Commits & Activities",
  4: "Code & Test Artifacts",
};

export function computeProvGraphLayout(
  nodes: ProvGraphNode[],
  edges: ProvGraphEdge[]
): GraphLayoutResult {
  const colBuckets = new Map<number, ProvGraphNode[]>();
  for (let c = 0; c <= 4; c++) colBuckets.set(c, []);

  for (const node of nodes) {
    const col = getColumnForNode(node);
    colBuckets.get(col)!.push(node);
  }

  // Keep only non-empty columns so focused subgraphs stay compact
  const activeCols = [...colBuckets.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([col, list]) => ({ col, list }));

  const nodeW = 196;
  const nodeH = 48;
  const colGap = 250;
  const rowGap = 66;
  const padX = 28;
  const padTop = 52;
  const padBottom = 28;

  const positionedNodes: PositionedNode[] = [];
  const nodeMap = new Map<string, PositionedNode>();
  const columnsMeta: Array<{ index: number; title: string; x: number }> = [];

  let maxRows = 1;
  activeCols.forEach(({ col, list }, idx) => {
    const x = padX + idx * colGap;
    columnsMeta.push({
      index: col,
      title: COLUMN_TITLES[col] ?? `Layer ${col}`,
      x,
    });
    if (list.length > maxRows) maxRows = list.length;

    list.forEach((node, rowIdx) => {
      const pNode: PositionedNode = {
        ...node,
        x,
        y: padTop + rowIdx * rowGap,
        width: nodeW,
        height: nodeH,
        column: idx,
      };
      positionedNodes.push(pNode);
      nodeMap.set(node.id, pNode);
    });
  });

  const width = Math.max(680, padX * 2 + Math.max(activeCols.length - 1, 0) * colGap + nodeW);
  const height = Math.max(260, padTop + maxRows * rowGap + padBottom);

  const positionedEdges: PositionedEdge[] = [];
  for (const edge of edges) {
    const src = nodeMap.get(edge.from);
    const dst = nodeMap.get(edge.to);
    if (!src || !dst || src.id === dst.id) continue;

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;

    if (src.x > dst.x) {
      x1 = src.x;
      y1 = src.y + src.height / 2;
      x2 = dst.x + dst.width;
      y2 = dst.y + dst.height / 2;
    } else if (src.x < dst.x) {
      x1 = src.x + src.width;
      y1 = src.y + src.height / 2;
      x2 = dst.x;
      y2 = dst.y + dst.height / 2;
    } else {
      // Same column vertical curve on right side
      x1 = src.x + src.width;
      y1 = src.y + src.height / 2;
      x2 = dst.x + dst.width;
      y2 = dst.y + dst.height / 2;
      const offset = 34;
      const pathD = `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 + offset} ${y2}, ${x2} ${y2}`;
      positionedEdges.push({
        ...edge,
        pathD,
        labelX: x1 + offset,
        labelY: (y1 + y2) / 2,
      });
      continue;
    }

    const dx = Math.abs(x2 - x1) * 0.45;
    const c1x = src.x > dst.x ? x1 - dx : x1 + dx;
    const c2x = src.x > dst.x ? x2 + dx : x2 - dx;
    const pathD = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;

    positionedEdges.push({
      ...edge,
      pathD,
      labelX: (x1 + x2) / 2,
      labelY: (y1 + y2) / 2 - 4,
    });
  }

  return {
    width,
    height,
    columns: columnsMeta,
    nodes: positionedNodes,
    edges: positionedEdges,
  };
}
