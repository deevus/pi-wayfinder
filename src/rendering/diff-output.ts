import * as Diff from "diff";

export interface DiffDetails {
  path: string;
  diff: string;
  firstChangedLine?: number;
}

export function firstChangedLineFromDiff(diff: string): number | undefined {
  for (const line of diff.split("\n")) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (match) return Number.parseInt(match[1], 10);
  }
  return undefined;
}

export function createUnifiedDiff(path: string, before: string, after: string): DiffDetails {
  if (before === after) return { path, diff: "", firstChangedLine: undefined };

  const normalizedBefore = before.replace(/\r\n/g, "\n");
  const normalizedAfter = after.replace(/\r\n/g, "\n");
  const diff = Diff.createTwoFilesPatch(path, path, normalizedBefore, normalizedAfter, "before", "after");
  return { path, diff, firstChangedLine: firstChangedLineFromDiff(diff) };
}

export function combineDiffs(diffs: Array<Pick<DiffDetails, "diff">>): string {
  return diffs
    .map((item) => item.diff.trimEnd())
    .filter((diff) => diff.length > 0)
    .join("\n\n");
}
