import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode, renderDiff } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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


function pathForLanguageDetection(path: string): string {
  return path.replace(/^@/, "").replace(/^(.+):(\d+)(?:-(\d+))?$/, "$1");
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
  const lang = rawPath ? getLanguageFromPath(pathForLanguageDetection(rawPath)) : undefined;
  const renderedLines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n").map((line) => theme.fg("toolOutput", replaceTabs(line)));
  const maxLines = options.expanded ? renderedLines.length : 10;
  const displayLines = renderedLines.slice(0, maxLines);
  const remaining = renderedLines.length - displayLines.length;

  let text = displayLines.join("\n");
  if (remaining > 0) text += theme.fg("muted", `\n... (${remaining} more lines, expand to view)`);
  return new Text(text, 0, 0);
}

export function renderReadFileResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: RenderContextLike,
): Container | Text {
  if (options.isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);

  const args = context.args as { paths?: unknown } | undefined;
  const paths = Array.isArray(args?.paths) ? args.paths : [];
  const sections = paths.length > 1 ? parseFileSections(getTextOutput(result)) : [];
  if (sections.length > 1) {
    const component = new Container();
    addTitledPanels(
      component,
      sections.map((section) => ({
        title: shortenDisplayPath(section.path),
        lines: renderSourceLines(section.path, section.lines, theme)
      })),
      theme,
      options.expanded,
    );
    return component;
  }

  if (paths.length === 1) {
    const component = new Container();
    component.addChild(new Spacer(1));
    component.addChild(renderCodeLikeResult(result, options, theme, context));
    return component;
  }

  return renderCodeLikeResult(result, options, theme, context);
}


class TitledPanel {
  constructor(
    private readonly title: string,
    private readonly lines: string[],
    private readonly theme: Theme
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    if (width < 3) return [truncateToWidth(this.title, width)];

    const bodyWidth = Math.max(1, width - 2);
    const borderChar = "─";
    const header = `─ ${truncateToWidth(this.title, Math.max(1, bodyWidth - 2), "")} `;
    const headerPadding = Math.max(0, bodyWidth - visibleWidth(header));
    const rendered = [this.theme.fg("accent", `╭${header}${borderChar.repeat(headerPadding)}╮`)];

    for (const line of this.lines) {
      const text = truncateToWidth(line, bodyWidth, "");
      const padding = Math.max(0, bodyWidth - visibleWidth(text));
      rendered.push(`${this.theme.fg("accent", "│")}${text}${" ".repeat(padding)}${this.theme.fg("accent", "│")}`);
    }

    rendered.push(this.theme.fg("accent", `╰${borderChar.repeat(bodyWidth)}╯`));
    return rendered;
  }
}

interface FileSection {
  path: string;
  lines: string[];
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1] === "") next.pop();
  return next;
}

function parseFileSections(text: string): FileSection[] {
  const sections: FileSection[] = [];
  let current: FileSection | undefined;

  for (const line of text.split("\n")) {
    const header = line.match(/^--- (.+) ---$/);
    if (header) {
      if (current) sections.push({ ...current, lines: trimTrailingEmptyLines(current.lines) });
      current = { path: header[1], lines: [] };
      continue;
    }

    if (!current || /^\[File Hash: .+\]$/.test(line)) continue;
    current.lines.push(stripAnchorPrefixesForDisplay(line));
  }

  if (current) sections.push({ ...current, lines: trimTrailingEmptyLines(current.lines) });
  return sections;
}

function renderSourceLines(path: string, lines: string[], theme: Theme): string[] {
  const text = replaceTabs(lines.join("\n"));
  const lang = getLanguageFromPath(pathForLanguageDetection(path));
  return lang ? highlightCode(text, lang) : text.split("\n").map((line) => theme.fg("toolOutput", line));
}

function panelDisplayLines(lines: string[], expanded: boolean): string[] {
  if (expanded || lines.length <= 10) return lines;
  const visibleLines = lines.slice(0, 10);
  return [...visibleLines, `... (${lines.length - visibleLines.length} more lines, expand to view)`];
}

function addTitledPanels(
  component: Container,
  panels: Array<{ title: string; lines: string[] }>,
  theme: Theme,
  expanded: boolean,
  truncateCollapsedPanels = true,
): void {
  for (const panel of panels) {
    component.addChild(new Spacer(1));
    const lines = truncateCollapsedPanels ? panelDisplayLines(panel.lines, expanded) : panel.lines;
    component.addChild(new TitledPanel(panel.title, lines, theme));
  }
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
    addTitledPanels(
      component,
      diffs.map((item) => ({ title: shortenDisplayPath(item.path), lines: renderDiff(item.diff).split("\n") })),
      theme,
      options.expanded,
      false,
    );
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
