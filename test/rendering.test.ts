import { beforeAll, describe, expect, it, vi } from "vitest";
import { initTheme } from "@mariozechner/pi-coding-agent";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { SymbolCache } from "../src/symbols/symbol-cache.js";
import { SymbolScanner } from "../src/symbols/symbol-scanner.js";
import { createUnifiedDiff, combineDiffs, firstChangedLineFromDiff } from "../src/rendering/diff-output.js";
import {
  renderCodeLikeCall,
  renderCodeLikeResult,
  renderDiffResult,
  stripAnchorPrefixesForDisplay,
  shortenDisplayPath,
} from "../src/rendering/pi-renderers.js";
import { registerEditFileTool } from "../src/tools/edit-file.js";
import { registerGetFileSkeletonTool } from "../src/tools/get-file-skeleton.js";
import { registerGetFunctionTool } from "../src/tools/get-function.js";
import { registerReadFileTool } from "../src/tools/read-file.js";
import { registerRenameSymbolTool } from "../src/tools/rename-symbol.js";
import { registerReplaceSymbolTool } from "../src/tools/replace-symbol.js";

const theme = {
  bold: (text: string) => `**${text}**`,
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
};

beforeAll(() => {
  initTheme(undefined, false);
});

const renderContext = {
  args: {},
  toolCallId: "tool-1",
  invalidate: vi.fn(),
  lastComponent: undefined,
  state: {},
  cwd: process.cwd(),
  executionStarted: true,
  argsComplete: true,
  isPartial: false,
  expanded: false,
  showImages: false,
  isError: false,
} as never;

type RegisteredTool = {
  name: string;
  renderCall?: (args: never, theme: never, context: never) => { render(width: number): string[] };
  renderResult?: (result: never, options: never, theme: never, context: never) => { render(width: number): string[] };
};

function collectTool(register: (pi: never, anchors: AnchorStateManager) => void): RegisteredTool {
  let tool: RegisteredTool | undefined;
  register({ registerTool: (registered: RegisteredTool) => { tool = registered; } } as never, new AnchorStateManager());
  if (!tool) throw new Error("tool was not registered");
  return tool;
}

function collectRenameTool(): RegisteredTool {
  let tool: RegisteredTool | undefined;
  const scanner = new SymbolScanner(new SymbolCache());
  registerRenameSymbolTool({ registerTool: (registered: RegisteredTool) => { tool = registered; } } as never, new AnchorStateManager(), scanner);
  if (!tool) throw new Error("rename_symbol was not registered");
  return tool;
}

describe("diff-output", () => {
  it("creates unified diffs and first changed line", () => {
    const result = createUnifiedDiff("sample.ts", "const value = 1;\n", "const value = 2;\n");

    expect(result.diff).toContain("-1 const value = 1;");
    expect(result.diff).toContain("+1 const value = 2;");
    expect(result.firstChangedLine).toBe(1);
    expect(firstChangedLineFromDiff(result.diff)).toBe(1);
  });

  it("returns an empty diff for unchanged content", () => {
    const result = createUnifiedDiff("sample.ts", "same\n", "same\n");

    expect(result.diff).toBe("");
    expect(result.firstChangedLine).toBeUndefined();
  });

  it("combines multi-file diffs with blank separators", () => {
    const first = createUnifiedDiff("first.ts", "a\n", "b\n");
    const second = createUnifiedDiff("second.ts", "x\n", "y\n");

    expect(combineDiffs([first, second])).toContain("Index: first.ts");
    expect(combineDiffs([first, second])).toContain("Index: second.ts");
    expect(combineDiffs([first, { path: "empty.ts", diff: "" }, second])).not.toContain("empty.ts");
  });
});

describe("pi render helpers", () => {
  it("strips raw anchor prefixes for display", () => {
    expect(stripAnchorPrefixesForDisplay("DiracA│const value = 1;")).toBe("const value = 1;");
    expect(stripAnchorPrefixesForDisplay("  (greet) DiracB│const value = greet();")).toBe("  (greet) const value = greet();");
    expect(stripAnchorPrefixesForDisplay("no anchor here")).toBe("no anchor here");
  });

  it("shortens long display paths", () => {
    expect(shortenDisplayPath("short.ts")).toBe("short.ts");
    expect(shortenDisplayPath("/tmp/a/very/long/path/sample.ts", 18)).toBe("…/path/sample.ts");
  });

  it("renders code-like calls and results without anchor prefixes", () => {
    const call = renderCodeLikeCall("read_file", ["src/sample.ts"], theme as never);
    const renderedCall = call.render(80).join("\n");
    expect(renderedCall).toContain("read_file");
    expect(renderedCall).toContain("src/sample.ts");

    const result = renderCodeLikeResult(
      { content: [{ type: "text", text: "--- src/sample.ts ---\nDiracA│const value = 1;\nDiracB│console.log(value);" }] },
      { expanded: false, isPartial: false },
      theme as never,
      renderContext,
    );
    const rendered = result.render(120).join("\n");

    expect(rendered).toContain("const value = 1;");
    expect(rendered).not.toContain("DiracA│");
  });

  it("renders diff results with pi renderDiff plumbing", () => {
    const diff = createUnifiedDiff("sample.ts", "const value = 1;\n", "const value = 2;\n");
    const result = renderDiffResult(
      { content: [{ type: "text", text: "Updated sample.ts" }], details: { diff: diff.diff } },
      { expanded: true, isPartial: false },
      theme as never,
      renderContext,
      "Updated",
    );
    const rendered = result.render(120).join("\n");

    expect(rendered).toContain("const value");
  });
});

describe("read-like tool renderers", () => {
  it("read_file renderer hides anchors in TUI output", () => {
    const tool = collectTool(registerReadFileTool as never);
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "--- src/sample.ts ---\nDiracA│const value = 1;" }] } as never,
      { expanded: true, isPartial: false } as never,
      theme as never,
      { ...renderContext, args: { paths: ["src/sample.ts"] } } as never,
    );

    const rendered = result?.render(120).join("\n") || "";
    expect(rendered).toContain("value =");
    expect(rendered).not.toContain("DiracA│");
  });

  it("get_file_skeleton and get_function expose renderers", () => {
    expect(collectTool(registerGetFileSkeletonTool as never).renderResult).toBeTypeOf("function");
    expect(collectTool(registerGetFunctionTool as never).renderResult).toBeTypeOf("function");
  });
});

describe("mutating tool renderers", () => {
  it("edit_file renderer displays diff output", () => {
    const tool = collectTool(registerEditFileTool as never);
    const diff = createUnifiedDiff("sample.ts", "const value = 1;\n", "const value = 2;\n");
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "Updated sample.ts" }], details: { diff: diff.diff } } as never,
      { expanded: true, isPartial: false } as never,
      theme as never,
      { ...renderContext, args: { files: [{ path: "sample.ts", edits: [] }] } } as never,
    );

    const rendered = result?.render(120).join("\n") || "";
    expect(rendered).toContain("const value");
  });
});

describe("symbol mutating renderers", () => {
  it("replace_symbol renderer displays diff output", () => {
    const tool = collectTool(registerReplaceSymbolTool as never);
    const diff = createUnifiedDiff("sample.ts", "function greet() { return 'hi'; }\n", "function greet() { return 'hello'; }\n");
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "Successfully replaced" }], details: { diff: diff.diff } } as never,
      { expanded: true, isPartial: false } as never,
      theme as never,
      { ...renderContext, args: { replacements: [{ path: "sample.ts" }] } } as never,
    );

    expect(result?.render(120).join("\n")).toContain("hello");
  });

  it("rename_symbol renderer displays diff output", () => {
    const tool = collectRenameTool();
    const diff = createUnifiedDiff("sample.ts", "greet();\n", "welcome();\n");
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "Successfully renamed" }], details: { diff: diff.diff } } as never,
      { expanded: true, isPartial: false } as never,
      theme as never,
      { ...renderContext, args: { paths: ["sample.ts"], existing_symbol: "greet", new_symbol: "welcome" } } as never,
    );

    expect(result?.render(120).join("\n")).toContain("welcome");
  });
});
