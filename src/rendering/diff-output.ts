import * as Diff from "diff";

export interface DiffDetails {
  path: string;
  diff: string;
  firstChangedLine?: number;
}

export function firstChangedLineFromDiff(diff: string): number | undefined {
  for (const line of diff.split("\n")) {
    const match = line.match(/^\+(\s*\d+)\s/);
    if (match) return Math.max(1, Number.parseInt(match[1], 10));
  }
  for (const line of diff.split("\n")) {
    const match = line.match(/^-(\s*\d+)\s/);
    if (match) return Math.max(1, Number.parseInt(match[1], 10));
  }
  return undefined;
}

function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function lineParts(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function pushContextLine(output: string[], lineNumWidth: number, lineNum: number, line: string): void {
  output.push(` ${String(lineNum).padStart(lineNumWidth, " ")} ${line}`);
}

export function createPiDiff(before: string, after: string, contextLines = 4): { diff: string; firstChangedLine?: number } {
  if (before === after) return { diff: "", firstChangedLine: undefined };

  const normalizedBefore = normalizeToLF(before);
  const normalizedAfter = normalizeToLF(after);
  const parts = Diff.diffLines(normalizedBefore, normalizedAfter);
  const oldLines = normalizedBefore.split("\n");
  const newLines = normalizedAfter.split("\n");
  const lineNumWidth = String(Math.max(oldLines.length, newLines.length)).length;
  const output: string[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const lines = lineParts(part.value);

    if (part.added || part.removed) {
      if (firstChangedLine === undefined) firstChangedLine = Math.max(1, newLineNum);
      for (const line of lines) {
        if (part.added) {
          output.push(`+${String(newLineNum).padStart(lineNumWidth, " ")} ${line}`);
          newLineNum++;
        } else {
          output.push(`-${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
      continue;
    }

    const nextPartIsChange = index < parts.length - 1 && (parts[index + 1].added || parts[index + 1].removed);
    const hasLeadingChange = lastWasChange;
    const hasTrailingChange = nextPartIsChange;

    if (hasLeadingChange && hasTrailingChange) {
      if (lines.length <= contextLines * 2) {
        for (const line of lines) {
          pushContextLine(output, lineNumWidth, oldLineNum, line);
          oldLineNum++;
          newLineNum++;
        }
      } else {
        const leadingLines = lines.slice(0, contextLines);
        const trailingLines = lines.slice(lines.length - contextLines);
        const skippedLines = lines.length - leadingLines.length - trailingLines.length;
        for (const line of leadingLines) {
          pushContextLine(output, lineNumWidth, oldLineNum, line);
          oldLineNum++;
          newLineNum++;
        }
        output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
        oldLineNum += skippedLines;
        newLineNum += skippedLines;
        for (const line of trailingLines) {
          pushContextLine(output, lineNumWidth, oldLineNum, line);
          oldLineNum++;
          newLineNum++;
        }
      }
    } else if (hasLeadingChange) {
      const shownLines = lines.slice(0, contextLines);
      const skippedLines = lines.length - shownLines.length;
      for (const line of shownLines) {
        pushContextLine(output, lineNumWidth, oldLineNum, line);
        oldLineNum++;
        newLineNum++;
      }
      if (skippedLines > 0) {
        output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
        oldLineNum += skippedLines;
        newLineNum += skippedLines;
      }
    } else if (hasTrailingChange) {
      const skippedLines = Math.max(0, lines.length - contextLines);
      if (skippedLines > 0) {
        output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
        oldLineNum += skippedLines;
        newLineNum += skippedLines;
      }
      for (const line of lines.slice(skippedLines)) {
        pushContextLine(output, lineNumWidth, oldLineNum, line);
        oldLineNum++;
        newLineNum++;
      }
    } else {
      oldLineNum += lines.length;
      newLineNum += lines.length;
    }

    lastWasChange = false;
  }

  return { diff: output.join("\n"), firstChangedLine };
}

export function createUnifiedDiff(path: string, before: string, after: string): DiffDetails {
  const { diff, firstChangedLine } = createPiDiff(before, after);
  return { path, diff, firstChangedLine };
}

export function combineDiffs(diffs: Array<Pick<DiffDetails, "path" | "diff">>): string {
  const nonEmptyDiffs = diffs.filter((item) => item.diff.trimEnd().length > 0);
  if (nonEmptyDiffs.length === 1) return nonEmptyDiffs[0].diff.trimEnd();
  return nonEmptyDiffs
    .map((item) => `Index: ${item.path}\n${item.diff.trimEnd()}`)
    .join("\n\n");
}
