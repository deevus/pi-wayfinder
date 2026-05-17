import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode, renderDiff } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

const RAW_ANCHOR_PREFIX = /^[A-Z][a-zA-Z]*│/;
const SYMBOL_ANCHOR_PREFIX = /^(\s*\([^)]*\)\s+)[A-Z][a-zA-Z]*│/;

export interface DiffRenderableDetails {
  diff?: string;
  diffs?: Array<{ path: string; diff: string; firstChangedLine?: number }>;
}

interface RenderContextLike {
  args?: unknown;
}

function getTextOutput(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n");
}

function replaceTabs(value: string): string {
  return value.replace(/\t/g, "    ");
}

function isDisplayMetadataLine(line: string): boolean {
  return (
    /^--- .+ ---$/.test(line) ||
    /^\[(File|Function) Hash: .+\]$/.test(line) ||
    line === "All Hash Anchors provided below are stable and can be used with edit_file directly."
  );
}

export function stripAnchorPrefixesForDisplay(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isDisplayMetadataLine(line))
    .map((line) => {
      const symbolMatch = line.match(SYMBOL_ANCHOR_PREFIX);
      if (symbolMatch) return line.replace(SYMBOL_ANCHOR_PREFIX, symbolMatch[1]);
      return line.replace(RAW_ANCHOR_PREFIX, "");
    })
    .join("\n");
}

export function shortenDisplayPath(path: string, maxLength = 60): string {
  if (path.length <= maxLength) return path;
  const parts = path.split(/[\\/]+/);
  let result = parts.pop() || path.slice(-maxLength);
  while (parts.length > 0 && result.length + parts[parts.length - 1].length + 1 < maxLength - 1) {
    result = `${parts.pop()}/${result}`;
  }
  return `…/${result}`;
}

export function renderCodeLikeCall(name: string, paths: string[], theme: Theme, suffix = ""): Text {
  const displayPaths = paths.length > 0 ? paths.map((path) => shortenDisplayPath(path)).join(", ") : "...";
  return new Text(`${theme.fg("toolTitle", theme.bold(name))} ${theme.fg("accent", displayPaths)}${suffix}`, 0, 0);
}

function firstPathFromContext(context: RenderContextLike): string | undefined {
  const args = context.args as { paths?: unknown; path?: unknown; files?: unknown } | undefined;
  if (Array.isArray(args?.paths)) return String(args.paths[0] || "") || undefined;
  if (typeof args?.path === "string") return args.path;
  if (Array.isArray(args?.files)) {
    const first = args.files[0] as { path?: unknown } | undefined;
    if (typeof first?.path === "string") return first.path;
  }
  return undefined;
}

export function renderCodeLikeResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: RenderContextLike,
): Text {
  if (options.isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);

  const output = stripAnchorPrefixesForDisplay(getTextOutput(result));
  const rawPath = firstPathFromContext(context);
  const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
  const renderedLines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n").map((line) => theme.fg("toolOutput", replaceTabs(line)));
  const maxLines = options.expanded ? renderedLines.length : 10;
  const displayLines = renderedLines.slice(0, maxLines);
  const remaining = renderedLines.length - displayLines.length;

  let text = displayLines.join("\n");
  if (remaining > 0) text += theme.fg("muted", `\n... (${remaining} more lines, expand to view)`);
  return new Text(text, 0, 0);
}

export function renderDiffResult(
  result: AgentToolResult<DiffRenderableDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  _context: RenderContextLike,
  partialLabel: string,
): Container | Text {
  if (options.isPartial) return new Text(theme.fg("warning", `${partialLabel}...`), 0, 0);

  const diff = result.details?.diff;
  const diffs = result.details?.diffs?.filter((item) => item.diff.trimEnd().length > 0) || [];
  const component = new Container();
  if (diffs.length > 1) {
    diffs.forEach((item, index) => {
      if (index > 0) component.addChild(new Text("", 0, 0));
      component.addChild(new Text(theme.fg("accent", `File: ${shortenDisplayPath(item.path)}`), 0, 0));
      component.addChild(new Text(renderDiff(item.diff), 0, 0));
    });
    return component;
  }

  if (!diff) {
    const text = getTextOutput(result) || partialLabel;
    component.addChild(new Text(theme.fg("success", text), 0, 0));
    return component;
  }

  component.addChild(new Text(renderDiff(diff), 0, 0));
  return component;
}
