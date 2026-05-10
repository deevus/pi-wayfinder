# Phase 4 Pi-native UX Renderers and Diffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Dirac tools render like first-class pi tools while preserving anchored model-facing content.

**Architecture:** Add small shared rendering and diff helpers, then wire them into read-like tools via `renderCall`/`renderResult` and mutating tools via unified diff details plus pi's exported `renderDiff`. Keep all existing tool schemas unchanged and keep anchors visible in returned `content` for the agent.

**Tech Stack:** TypeScript, pi extension API, pi TUI exports (`Text`, `Container`, `Spacer`, `renderDiff`, `highlightCode`, `getLanguageFromPath`), existing `diff` package, Vitest.

---

## Source References

Read these before implementing:

- Spec: `docs/superpowers/specs/2026-05-10-phase-4-pi-native-ux-renderers-and-diffs-design.md`
- Pi renderer docs: `/Users/sh/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.73.1/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md` around “Overriding Built-in Tools” and rendering inheritance.
- Pi built-in renderer example: `/Users/sh/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.73.1/node_modules/@mariozechner/pi-coding-agent/examples/extensions/built-in-tool-renderer.ts`
- Pi exported renderer/types declarations:
  - `/Users/sh/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.73.1/node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts`
  - `/Users/sh/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.73.1/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
- Current tools:
  - `src/tools/read-file.ts`
  - `src/tools/get-file-skeleton.ts`
  - `src/tools/get-function.ts`
  - `src/tools/find-symbol-references.ts`
  - `src/tools/edit-file.ts`
  - `src/tools/replace-symbol.ts`
  - `src/tools/rename-symbol.ts`

## File Structure

- Create `src/rendering/diff-output.ts`
  - Generates unified diffs using the existing `diff` package.
  - Exports `createUnifiedDiff`, `combineDiffs`, `firstChangedLineFromDiff`, and `DiffDetails` types.
- Create `src/rendering/pi-renderers.ts`
  - Strips anchors only for TUI display.
  - Provides shared pi-style `renderCall`, code-like result, and diff result helpers.
- Create `test/rendering.test.ts`
  - Unit tests for anchor stripping, diff generation, and renderer smoke behavior.
- Modify read-like tools:
  - `src/tools/read-file.ts`
  - `src/tools/get-file-skeleton.ts`
  - `src/tools/get-function.ts`
  - `src/tools/find-symbol-references.ts`
- Modify mutating tools:
  - `src/tools/edit-file.ts`
  - `src/tools/replace-symbol.ts`
  - `src/tools/rename-symbol.ts`
- Modify tests:
  - `test/edit-file.test.ts`
  - `test/replace-symbol.test.ts`
  - `test/rename-symbol.test.ts`
  - `test/read-file.test.ts`, `test/ast-tools.test.ts`, and `test/find-symbol-references.test.ts` are expected to remain unchanged because the task preserves model-facing content and does not change exact output assertions.
- Modify `README.md`
  - Document that interactive TUI hides anchor noise while model-facing content remains anchored, and mutating tools render diffs.

---

### Task 1: Add shared diff and pi-rendering helpers

**Files:**
- Create: `src/rendering/diff-output.ts`
- Create: `src/rendering/pi-renderers.ts`
- Create: `test/rendering.test.ts`

- [ ] **Step 1: Write failing rendering helper tests**

Create `test/rendering.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createUnifiedDiff, combineDiffs, firstChangedLineFromDiff } from "../src/rendering/diff-output.js";
import {
  renderCodeLikeCall,
  renderCodeLikeResult,
  renderDiffResult,
  stripAnchorPrefixesForDisplay,
  shortenDisplayPath,
} from "../src/rendering/pi-renderers.js";

const theme = {
  bold: (text: string) => `**${text}**`,
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
};

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

describe("diff-output", () => {
  it("creates unified diffs and first changed line", () => {
    const result = createUnifiedDiff("sample.ts", "const value = 1;\n", "const value = 2;\n");

    expect(result.diff).toContain("--- sample.ts\tbefore");
    expect(result.diff).toContain("+++ sample.ts\tafter");
    expect(result.diff).toContain("-const value = 1;");
    expect(result.diff).toContain("+const value = 2;");
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

    expect(combineDiffs([first, second])).toContain("--- first.ts");
    expect(combineDiffs([first, second])).toContain("--- second.ts");
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
    expect(call.render(80).join("\n")).toContain("read_file src/sample.ts");

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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run test/rendering.test.ts
```

Expected: FAIL because `src/rendering/diff-output.ts` and `src/rendering/pi-renderers.ts` do not exist.

- [ ] **Step 3: Implement diff helper**

Create `src/rendering/diff-output.ts`:

```ts
import { createTwoFilesPatch } from "diff";

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
  const diff = createTwoFilesPatch(path, path, normalizedBefore, normalizedAfter, "before", "after");
  return { path, diff, firstChangedLine: firstChangedLineFromDiff(diff) };
}

export function combineDiffs(diffs: Array<Pick<DiffDetails, "diff">>): string {
  return diffs
    .map((item) => item.diff.trimEnd())
    .filter((diff) => diff.length > 0)
    .join("\n\n");
}
```

- [ ] **Step 4: Implement renderer helper**

Create `src/rendering/pi-renderers.ts`:

```ts
import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { Theme, ToolRenderContext, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Container, getLanguageFromPath, highlightCode, renderDiff, Spacer, Text } from "@mariozechner/pi-coding-agent";

const RAW_ANCHOR_PREFIX = /^[A-Z][a-zA-Z]*│/;
const SYMBOL_ANCHOR_PREFIX = /^(\s*\([^)]*\)\s+)[A-Z][a-zA-Z]*│/;

export interface DiffRenderableDetails {
  diff?: string;
  diffs?: Array<{ path: string; diff: string; firstChangedLine?: number }>;
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

export function stripAnchorPrefixesForDisplay(text: string): string {
  return text
    .split("\n")
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

export function renderCodeLikeResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: ToolRenderContext,
): Text {
  if (options.isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);

  const output = stripAnchorPrefixesForDisplay(getTextOutput(result));
  const rawPath = Array.isArray((context.args as { paths?: unknown }).paths)
    ? String((context.args as { paths: unknown[] }).paths[0] || "")
    : String((context.args as { path?: unknown }).path || "");
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
  _context: ToolRenderContext,
  partialLabel: string,
): Container | Text {
  if (options.isPartial) return new Text(theme.fg("warning", `${partialLabel}...`), 0, 0);

  const diff = result.details?.diff;
  const component = new Container();
  if (!diff) {
    const text = getTextOutput(result) || partialLabel;
    component.addChild(new Text(theme.fg("success", text), 0, 0));
    return component;
  }

  const summary = getTextOutput(result).split("\n")[0] || partialLabel;
  component.addChild(new Text(theme.fg("success", summary), 0, 0));
  if (options.expanded) {
    component.addChild(new Spacer(1));
    component.addChild(new Text(renderDiff(diff), 0, 0));
  }
  return component;
}
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
npx vitest run test/rendering.test.ts
```

Expected: PASS. If TypeScript reports `Theme` or `ToolRenderContext` are not exported directly, import them as types from `@mariozechner/pi-coding-agent/dist/core/extensions/types.js` only if the package export allows it; otherwise use structural local types with `unknown` fields and keep runtime imports from the public package root.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit helper layer**

```bash
git add src/rendering/diff-output.ts src/rendering/pi-renderers.ts test/rendering.test.ts
git commit -m "feat: add pi rendering helpers"
```

---

### Task 2: Add clean pi-style renderers for read-like tools

**Files:**
- Modify: `src/tools/read-file.ts`
- Modify: `src/tools/get-file-skeleton.ts`
- Modify: `src/tools/get-function.ts`
- Modify: `src/tools/find-symbol-references.ts`
- Modify: `test/rendering.test.ts`

- [ ] **Step 1: Add renderer smoke tests**

Append to `test/rendering.test.ts`:

```ts
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { registerReadFileTool } from "../src/tools/read-file.js";
import { registerGetFileSkeletonTool } from "../src/tools/get-file-skeleton.js";
import { registerGetFunctionTool } from "../src/tools/get-function.js";

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

describe("read-like tool renderers", () => {
  it("read_file renderer hides anchors in TUI output", () => {
    const tool = collectTool(registerReadFileTool);
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "--- src/sample.ts ---\nDiracA│const value = 1;" }] },
      { expanded: true, isPartial: false },
      theme,
      { ...renderContext, args: { paths: ["src/sample.ts"] } },
    );

    const rendered = result?.render(120).join("\n") || "";
    expect(rendered).toContain("const value = 1;");
    expect(rendered).not.toContain("DiracA│");
  });

  it("get_file_skeleton and get_function expose renderers", () => {
    expect(collectTool(registerGetFileSkeletonTool).renderResult).toBeTypeOf("function");
    expect(collectTool(registerGetFunctionTool).renderResult).toBeTypeOf("function");
  });
});
```

If this creates duplicate imports in the middle of the file, move the imports to the top of `test/rendering.test.ts`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run test/rendering.test.ts
```

Expected: FAIL because the tools do not yet define `renderCall`/`renderResult`.

- [ ] **Step 3: Add imports and renderers to `read_file`**

Modify `src/tools/read-file.ts` imports:

```ts
import { renderCodeLikeCall, renderCodeLikeResult } from "../rendering/pi-renderers.js";
```

Inside the `pi.registerTool({ ... })` object, after `parameters: ReadFileSchema,` add:

```ts
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      const start = typeof args.start_line === "number" ? args.start_line : undefined;
      const end = typeof args.end_line === "number" ? args.end_line : undefined;
      const suffix = start || end ? theme.fg("warning", `:${start ?? 1}${end ? `-${end}` : ""}`) : "";
      return renderCodeLikeCall("read_file", paths, theme, suffix);
    },
    renderResult(result, options, theme, context) {
      return renderCodeLikeResult(result, options, theme, context);
    },
```

- [ ] **Step 4: Add renderers to `get_file_skeleton`**

Modify `src/tools/get-file-skeleton.ts` imports:

```ts
import { renderCodeLikeCall, renderCodeLikeResult } from "../rendering/pi-renderers.js";
```

Inside the registered tool object, after `parameters: GetFileSkeletonSchema,` add:

```ts
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      return renderCodeLikeCall("get_file_skeleton", paths, theme);
    },
    renderResult(result, options, theme, context) {
      return renderCodeLikeResult(result, options, theme, context);
    },
```

- [ ] **Step 5: Add renderers to `get_function`**

Modify `src/tools/get-function.ts` imports:

```ts
import { renderCodeLikeCall, renderCodeLikeResult } from "../rendering/pi-renderers.js";
```

Inside the registered tool object, after `parameters: GetFunctionSchema,` add:

```ts
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      const names = Array.isArray(args.function_names) ? args.function_names.join(", ") : "";
      const suffix = names ? theme.fg("dim", ` (${names})`) : "";
      return renderCodeLikeCall("get_function", paths, theme, suffix);
    },
    renderResult(result, options, theme, context) {
      return renderCodeLikeResult(result, options, theme, context);
    },
```

- [ ] **Step 6: Add renderers to `find_symbol_references`**

Modify `src/tools/find-symbol-references.ts` imports:

```ts
import { renderCodeLikeCall, renderCodeLikeResult } from "../rendering/pi-renderers.js";
```

Inside the registered tool object, after `parameters: FindSymbolReferencesSchema,` add:

```ts
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      const symbols = Array.isArray(args.symbols) ? args.symbols.join(", ") : "";
      const suffix = symbols ? theme.fg("dim", ` (${symbols})`) : "";
      return renderCodeLikeCall("find_symbol_references", paths, theme, suffix);
    },
    renderResult(result, options, theme, context) {
      return renderCodeLikeResult(result, options, theme, context);
    },
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npx vitest run test/rendering.test.ts test/read-file.test.ts test/ast-tools.test.ts test/find-symbol-references.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit read-like renderers**

```bash
git add src/tools/read-file.ts src/tools/get-file-skeleton.ts src/tools/get-function.ts src/tools/find-symbol-references.ts test/rendering.test.ts
git commit -m "feat: render read-like tools cleanly"
```

---

### Task 3: Add diffs and pi-style rendering to `edit_file`

**Files:**
- Modify: `src/tools/edit-file.ts`
- Modify: `test/edit-file.test.ts`
- Modify: `test/rendering.test.ts`

- [ ] **Step 1: Add failing `edit_file` diff tests**

Append to `test/edit-file.test.ts`:

```ts
  it("returns unified diff details for anchored edits", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "const value = 1;\nconsole.log(value);\n", "utf8");

    const anchors = new AnchorStateManager();
    anchors.reconcile(filePath, ["const value = 1;", "console.log(value);", ""]);
    const tool = registerToolForTest(anchors);
    const result = await tool.execute("call-diff", {
      files: [{
        path: "sample.ts",
        edits: [{ edit_type: "replace", anchor: "DiracA│const value = 1;", end_anchor: "DiracA│const value = 1;", text: "const value = 2;" }],
      }],
    }, undefined, undefined, { cwd } as never);

    expect(result.details).toMatchObject({ files: ["sample.ts"] });
    expect(result.details?.diff).toContain("-const value = 1;");
    expect(result.details?.diff).toContain("+const value = 2;");
    expect(result.details?.diffs).toEqual([
      expect.objectContaining({ path: "sample.ts", firstChangedLine: 1 }),
    ]);
  });
```

If helper names differ in the existing test file, adapt only the setup names; keep the assertions exactly about `details.diff` and `details.diffs`.

- [ ] **Step 2: Add renderer smoke test for `edit_file`**

Append to `test/rendering.test.ts`:

```ts
import { registerEditFileTool } from "../src/tools/edit-file.js";

describe("mutating tool renderers", () => {
  it("edit_file renderer displays diff output", () => {
    const tool = collectTool(registerEditFileTool);
    const diff = createUnifiedDiff("sample.ts", "const value = 1;\n", "const value = 2;\n");
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "Updated sample.ts" }], details: { diff: diff.diff } },
      { expanded: true, isPartial: false },
      theme,
      { ...renderContext, args: { files: [{ path: "sample.ts", edits: [] }] } },
    );

    const rendered = result?.render(120).join("\n") || "";
    expect(rendered).toContain("const value");
  });
});
```

Place the `registerEditFileTool` import with the other imports at the top of `test/rendering.test.ts`.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run test/edit-file.test.ts test/rendering.test.ts
```

Expected: FAIL because `edit_file` has no diff details or renderer.

- [ ] **Step 4: Update `edit-file.ts` imports and details types**

Modify `src/tools/edit-file.ts` imports:

```ts
import { combineDiffs, createUnifiedDiff, type DiffDetails } from "../rendering/diff-output.js";
import { renderCodeLikeCall, renderDiffResult } from "../rendering/pi-renderers.js";
```

Add near existing interfaces:

```ts
interface EditFileToolDetails {
  files: string[];
  diff: string;
  diffs: DiffDetails[];
  firstChangedLine?: number;
}
```

- [ ] **Step 5: Add renderer methods to `edit_file`**

Inside the `pi.registerTool({ ... })` object in `src/tools/edit-file.ts`, after `parameters: EditFileSchema,` add:

```ts
    renderCall(args, theme) {
      const files = Array.isArray(args.files) ? args.files.map((file) => file.path).filter((path): path is string => typeof path === "string") : [];
      return renderCodeLikeCall("edit_file", files, theme);
    },
    renderResult(result, options, theme, context) {
      return renderDiffResult(result, options, theme, context, "Editing");
    },
```

- [ ] **Step 6: Compute diffs during execution**

In `src/tools/edit-file.ts`, change:

```ts
      const summaries: string[] = [];
```

to:

```ts
      const summaries: string[] = [];
      const diffs: DiffDetails[] = [];
```

After `const nextContent = nextLines.join(lineEnding);`, add:

```ts
          const diff = createUnifiedDiff(file.path, content, nextContent);
          if (diff.diff) diffs.push(diff);
```

Change the return details from:

```ts
        details: { files: params.files.map((file) => file.path) }
```

to:

```ts
        details: {
          files: params.files.map((file) => file.path),
          diffs,
          diff: combineDiffs(diffs),
          firstChangedLine: diffs[0]?.firstChangedLine,
        } satisfies EditFileToolDetails
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npx vitest run test/edit-file.test.ts test/rendering.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit `edit_file` UX**

```bash
git add src/tools/edit-file.ts test/edit-file.test.ts test/rendering.test.ts
git commit -m "feat: render edit file diffs"
```

---

### Task 4: Add diffs and pi-style rendering to `replace_symbol` and `rename_symbol`

**Files:**
- Modify: `src/tools/replace-symbol.ts`
- Modify: `src/tools/rename-symbol.ts`
- Modify: `test/replace-symbol.test.ts`
- Modify: `test/rename-symbol.test.ts`
- Modify: `test/rendering.test.ts`

- [ ] **Step 1: Add failing `replace_symbol` diff test**

Append to `test/replace-symbol.test.ts`:

```ts
  it("returns unified diff details", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "function greet() {\n  return 'hi';\n}\n", "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-diff", {
      replacements: [{
        path: "sample.ts",
        symbol: "greet",
        type: "function",
        text: "function greet() {\n  return 'hello';\n}",
      }],
    }, undefined, undefined, { cwd } as never);

    expect(result.details?.diff).toContain("-  return 'hi';");
    expect(result.details?.diff).toContain("+  return 'hello';");
    expect(result.details?.diffs).toEqual([
      expect.objectContaining({ path: "sample.ts", firstChangedLine: 1 }),
    ]);
  });
```

- [ ] **Step 2: Add failing `rename_symbol` diff test**

Append to `test/rename-symbol.test.ts`:

```ts
  it("returns unified diff details across files", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "first.ts"), "export function greet() { return 'hi'; }\n", "utf8");
    await writeFile(join(cwd, "second.ts"), "import { greet } from './first';\nconsole.log(greet());\n", "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-diff", { paths: ["."], existing_symbol: "greet", new_symbol: "welcome" }, undefined, undefined, { cwd } as never);

    expect(result.details?.diff).toContain("welcome");
    expect(result.details?.diffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "first.ts" }),
      expect.objectContaining({ path: "second.ts" }),
    ]));
  });
```

- [ ] **Step 3: Add renderer smoke tests**

Append to `test/rendering.test.ts`:

```ts
import { registerReplaceSymbolTool } from "../src/tools/replace-symbol.js";
import { registerRenameSymbolTool } from "../src/tools/rename-symbol.js";
import { SymbolCache } from "../src/symbols/symbol-cache.js";
import { SymbolScanner } from "../src/symbols/symbol-scanner.js";

function collectRenameTool(): RegisteredTool {
  let tool: RegisteredTool | undefined;
  const scanner = new SymbolScanner(new SymbolCache());
  registerRenameSymbolTool({ registerTool: (registered: RegisteredTool) => { tool = registered; } } as never, new AnchorStateManager(), scanner);
  if (!tool) throw new Error("rename_symbol was not registered");
  return tool;
}

describe("symbol mutating renderers", () => {
  it("replace_symbol renderer displays diff output", () => {
    const tool = collectTool(registerReplaceSymbolTool);
    const diff = createUnifiedDiff("sample.ts", "function greet() { return 'hi'; }\n", "function greet() { return 'hello'; }\n");
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "Successfully replaced" }], details: { diff: diff.diff } },
      { expanded: true, isPartial: false },
      theme,
      { ...renderContext, args: { replacements: [{ path: "sample.ts" }] } },
    );

    expect(result?.render(120).join("\n")).toContain("hello");
  });

  it("rename_symbol renderer displays diff output", () => {
    const tool = collectRenameTool();
    const diff = createUnifiedDiff("sample.ts", "greet();\n", "welcome();\n");
    const result = tool.renderResult?.(
      { content: [{ type: "text", text: "Successfully renamed" }], details: { diff: diff.diff } },
      { expanded: true, isPartial: false },
      theme,
      { ...renderContext, args: { paths: ["sample.ts"], existing_symbol: "greet", new_symbol: "welcome" } },
    );

    expect(result?.render(120).join("\n")).toContain("welcome");
  });
});
```

Place all imports with the other imports at the top of `test/rendering.test.ts`. Replace `collectTool(registerReplaceSymbolTool)` with this exact helper call if TypeScript rejects the existing helper signature:

```ts
function collectSimpleTool(register: (pi: never, anchors: AnchorStateManager) => void): RegisteredTool {
  let tool: RegisteredTool | undefined;
  register({ registerTool: (registered: RegisteredTool) => { tool = registered; } } as never, new AnchorStateManager());
  if (!tool) throw new Error("tool was not registered");
  return tool;
}
```

Then call `collectSimpleTool(registerReplaceSymbolTool)` in the `replace_symbol` renderer test.

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
npx vitest run test/replace-symbol.test.ts test/rename-symbol.test.ts test/rendering.test.ts
```

Expected: FAIL because symbol tools do not yet return diffs or render them.

- [ ] **Step 5: Update `replace-symbol.ts` imports and details type**

Modify `src/tools/replace-symbol.ts` imports:

```ts
import { combineDiffs, createUnifiedDiff, type DiffDetails } from "../rendering/diff-output.js";
import { renderCodeLikeCall, renderDiffResult } from "../rendering/pi-renderers.js";
```

Add near existing interfaces:

```ts
interface ReplaceSymbolToolDetails {
  paths: string[];
  symbols: string[];
  diff: string;
  diffs: DiffDetails[];
  firstChangedLine?: number;
}
```

- [ ] **Step 6: Add renderer methods to `replace_symbol`**

Inside the registered tool object in `src/tools/replace-symbol.ts`, after `parameters: ReplaceSymbolSchema,` add:

```ts
    renderCall(args, theme) {
      const paths = Array.isArray(args.replacements)
        ? args.replacements.map((replacement) => replacement.path).filter((path): path is string => typeof path === "string")
        : [];
      return renderCodeLikeCall("replace_symbol", paths, theme);
    },
    renderResult(result, options, theme, context) {
      return renderDiffResult(result, options, theme, context, "Replacing");
    },
```

- [ ] **Step 7: Compute replace diffs during prepare**

In `src/tools/replace-symbol.ts`, update `PreparedFileReplacementBatch`:

```ts
interface PreparedFileReplacementBatch {
  batch: FileReplacementBatch;
  finalContent: string;
  finalLines: string[];
  diff: DiffDetails;
}
```

When pushing prepared batches, change:

```ts
          preparedBatches.push({
            batch,
            finalContent,
            finalLines: finalContent.split(/\r?\n/),
          });
```

to:

```ts
          preparedBatches.push({
            batch,
            finalContent,
            finalLines: finalContent.split(/\r?\n/),
            diff: createUnifiedDiff(batch.displayPath, originalContent, finalContent),
          });
```

Before the write loop inside `withFileMutationQueues`, add:

```ts
        const diffs = preparedBatches.map((prepared) => prepared.diff).filter((diff) => diff.diff.length > 0);
```

Move `diffs` to the outer scope by declaring before the queue:

```ts
      let diffs: DiffDetails[] = [];
```

and assigning inside:

```ts
        diffs = preparedBatches.map((prepared) => prepared.diff).filter((diff) => diff.diff.length > 0);
```

Change return details to:

```ts
        details: {
          paths: batches.map((batch) => batch.displayPath),
          symbols: replacements.map((replacement) => replacement.symbol),
          diffs,
          diff: combineDiffs(diffs),
          firstChangedLine: diffs[0]?.firstChangedLine,
        } satisfies ReplaceSymbolToolDetails,
```

- [ ] **Step 8: Update `rename-symbol.ts` imports and details type**

Modify `src/tools/rename-symbol.ts` imports:

```ts
import { combineDiffs, createUnifiedDiff, type DiffDetails } from "../rendering/diff-output.js";
import { renderCodeLikeCall, renderDiffResult } from "../rendering/pi-renderers.js";
```

Update `PreparedRenameFile`:

```ts
interface PreparedRenameFile {
  absolutePath: string;
  displayPath: string;
  finalContent: string;
  finalLines: string[];
  replacementCount: number;
  diff: DiffDetails;
}
```

Add details type:

```ts
interface RenameSymbolToolDetails {
  paths: string[];
  existing_symbol: string;
  new_symbol: string;
  replacements: number;
  files?: string[];
  diff?: string;
  diffs?: DiffDetails[];
  firstChangedLine?: number;
}
```

- [ ] **Step 9: Add renderer methods to `rename_symbol`**

Inside the registered tool object in `src/tools/rename-symbol.ts`, after `parameters: RenameSymbolSchema,` add:

```ts
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      const suffix = typeof args.existing_symbol === "string" && typeof args.new_symbol === "string"
        ? theme.fg("dim", ` (${args.existing_symbol} → ${args.new_symbol})`)
        : "";
      return renderCodeLikeCall("rename_symbol", paths, theme, suffix);
    },
    renderResult(result, options, theme, context) {
      return renderDiffResult(result, options, theme, context, "Renaming");
    },
```

- [ ] **Step 10: Compute rename diffs during prepare**

In the prepare loop in `src/tools/rename-symbol.ts`, change:

```ts
          prepared.push({
            absolutePath,
            displayPath: fileLocations[0]?.displayPath || absolutePath,
            finalContent,
            finalLines: finalContent.split(/\r?\n/),
            replacementCount
          });
```

to:

```ts
          const displayPath = fileLocations[0]?.displayPath || absolutePath;
          prepared.push({
            absolutePath,
            displayPath,
            finalContent,
            finalLines: finalContent.split(/\r?\n/),
            replacementCount,
            diff: createUnifiedDiff(displayPath, originalContent, finalContent),
          });
```

After `preparedFiles` is returned from the queue, add:

```ts
      const diffs = preparedFiles.map((file) => file.diff).filter((diff) => diff.diff.length > 0);
```

Change the no-op return details to:

```ts
          details: { paths, existing_symbol: existingSymbol, new_symbol: newSymbol, replacements: 0 } satisfies RenameSymbolToolDetails
```

Change the success return details to:

```ts
        details: {
          paths,
          existing_symbol: existingSymbol,
          new_symbol: newSymbol,
          replacements: totalReplacements,
          files: preparedFiles.map((file) => file.displayPath),
          diffs,
          diff: combineDiffs(diffs),
          firstChangedLine: diffs[0]?.firstChangedLine,
        } satisfies RenameSymbolToolDetails
```

- [ ] **Step 11: Run targeted tests**

Run:

```bash
npx vitest run test/replace-symbol.test.ts test/rename-symbol.test.ts test/rendering.test.ts
```

Expected: PASS.

- [ ] **Step 12: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 13: Commit symbol mutating UX**

```bash
git add src/tools/replace-symbol.ts src/tools/rename-symbol.ts test/replace-symbol.test.ts test/rename-symbol.test.ts test/rendering.test.ts
git commit -m "feat: render symbol mutation diffs"
```

---

### Task 5: Documentation, interactive smoke test, and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-05-10-phase-4-pi-native-ux-renderers-and-diffs.md`

- [ ] **Step 1: Update README UX documentation**

Append to `README.md` after the symbol tools sections:

```md
## Interactive rendering

In pi's interactive TUI, Dirac tools render with pi-native readable output:

- read-like tools hide `DiracX│` anchor prefixes visually while preserving anchors in model-facing tool content;
- `edit_file`, `replace_symbol`, and `rename_symbol` render unified diffs using pi's diff renderer;
- print/JSON/API outputs keep the same anchored text contract used by the agent.

This means humans see clean code and diffs, while the agent still receives stable anchors for follow-up edits.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test && npm run typecheck
```

Expected: all tests pass and TypeScript completes without errors.

- [ ] **Step 3: Smoke-test loaded tools in pi session**

Use the current pi session tools on a temporary fixture:

```bash
tmpdir=$(mktemp -d /tmp/pi-dirac-ux-smoke-XXXXXX)
cat > "$tmpdir/sample.ts" <<'EOF'
export function greet(name: string) {
  return name.toUpperCase();
}

const message = greet('Ada');
EOF
printf '%s\n' "$tmpdir"
```

Then call these tools manually in the current session:

```json
find_symbol_references({"paths":["/tmp/pi-dirac-ux-smoke-XXXXXX/sample.ts"],"symbols":["greet"],"find_type":"both"})
rename_symbol({"paths":["/tmp/pi-dirac-ux-smoke-XXXXXX/sample.ts"],"existing_symbol":"greet","new_symbol":"welcome"})
read_file({"paths":["/tmp/pi-dirac-ux-smoke-XXXXXX/sample.ts"]})
replace_symbol({"replacements":[{"path":"/tmp/pi-dirac-ux-smoke-XXXXXX/sample.ts","symbol":"welcome","type":"function","text":"export function welcome(name: string) {\n  return `Hello, ${name}`;\n}"}]})
```

Expected:

- Tool content still includes anchors where applicable.
- Interactive TUI renderers show clean human output without raw `DiracX│` noise.
- Mutating tools show diffs.

Clean up:

```bash
rm -rf /tmp/pi-dirac-ux-smoke-XXXXXX
```

- [ ] **Step 4: Update plan verification note**

At the top of this plan, below the Tech Stack paragraph, add:

Use this sentence shape with the actual counts from Vitest output:

```md
Verification evidence: `npm test && npm run typecheck` passed with 14 test files / 92 tests. Manual pi smoke test passed for clean read-like rendering and mutating diffs.
```

Replace `14 test files / 92 tests` with the real counts from the verification run, and omit the manual smoke sentence if the smoke test was not performed.

- [ ] **Step 5: Commit docs and verification evidence**

```bash
git add README.md docs/superpowers/plans/2026-05-10-phase-4-pi-native-ux-renderers-and-diffs.md
git commit -m "docs: document pi native ux rendering"
```

- [ ] **Step 6: Request code review**

Use the requesting-code-review process. Ask the reviewer to check:

- anchors remain visible in model-facing `content`;
- read-like TUI renderers strip anchors visually only;
- mutating tools include accurate diffs;
- renderer imports use pi public exports, not deep private paths;
- schemas remain unchanged;
- no extra `ctx.ui.confirm` calls;
- tests cover helper behavior and tool details.

- [ ] **Step 7: Final verification before completion**

Run again after review fixes:

```bash
npm test && npm run typecheck
```

Expected: PASS. Do not claim completion without fresh passing output.
