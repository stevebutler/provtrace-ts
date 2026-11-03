export function formatDatastarPatchElements(
  html: string,
  options?: { selector?: string; mode?: "outer" | "inner" | "append" | "prepend" | "remove" }
): { event: string; data: string } {
  const lines: string[] = [];
  if (options?.selector) {
    lines.push(`selector ${options.selector}`);
  }
  if (options?.mode && options.mode !== "outer") {
    lines.push(`mode ${options.mode}`);
  }
  for (const line of html.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      lines.push(`elements ${line}`);
    }
  }
  return {
    event: "datastar-patch-elements",
    data: lines.join("\n"),
  };
}

export function formatDatastarPatchSignals(signals: Record<string, unknown>): {
  event: string;
  data: string;
} {
  return {
    event: "datastar-patch-signals",
    data: `signals ${JSON.stringify(signals)}`,
  };
}
