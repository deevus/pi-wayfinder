# Phase 2 Replace Symbol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pi-native `replace_symbol` tool that replaces complete tree-sitter AST symbols by name.

**Architecture:** Build a focused `src/tools/replace-symbol.ts` module around the Phase 1 `ASTAnchorBridge.getSymbolRange(...)` API. The module groups replacements by file, resolves all symbol ranges before mutation, rejects overlaps, strips hash anchors, normalizes replacement EOLs to the target file, applies ranges bottom-to-top, and writes each file once through pi's file mutation queue.

**Tech Stack:** TypeScript, pi extension API, `typebox`, `web-tree-sitter` via existing AST bridge, Vitest, Node `fs/promises`, existing `AnchorStateManager` and line-hashing utilities.

---

## File Structure

- Create `src/tools/replace-symbol.ts`
  - Defines `SymbolReplacement`, `ResolvedSymbolReplacement`, and helpers for EOL detection, replacement text normalization, overlap detection, range application, and pi tool registration.
  - Exports pure helpers for unit tests: `normalizeReplacementText`, `applyResolvedSymbolReplacements`, and `groupReplacementsByPath`.
  - Exports `registerReplaceSymbolTool(pi, anchors)`.
- Modify `src/tools/schemas.ts`
  - Adds `ReplaceSymbolSchema` requiring batch-only `replacements`.
- Modify `src/index.ts`
  - Registers `replace_symbol` with the shared `AnchorStateManager`.
- Modify `src/mode.ts`
  - Adds `replace_symbol` to the Dirac tool list for additive, preferred, and replacement modes.
- Modify `src/prompt.ts`
  - Mentions `replace_symbol` as the tool for complete symbol replacements in all modes.
- Modify `src/index.test.ts`
  - Updates active-tool assertions for the new tool.
- Create `test/replace-symbol.test.ts`
  - Covers pure replacement helpers and registered pi tool behavior.
- Modify `README.md`
  - Documents `replace_symbol` briefly and shows batch-only usage.

## Implementation Notes

- Public API is batch-only. Do not support top-level `path`, `symbol`, `text`, or `type` in the schema or implementation.
- `type` is optional and is passed through to `ASTAnchorBridge.getSymbolRange(...)`.
- Ambiguous suffix matches intentionally use the first compatible range returned by the AST bridge.
- There is no regex fallback for this tool.
- Unsupported parser, parse failure, and missing symbol all surface as `Symbol '<name>'... not found in <path>.`.
- Existing anchors for replaced symbols are stale after a successful edit; include that warning in success output.
- Use `withFileMutationQueue(absolutePath, async () => { ... })` for each file batch, matching `edit_file`.
- Do not call `ctx.ui.confirm(...)` from Dirac tools; pi owns tool approval/permission UX.
- Throw promptly on abort via a local `throwIfAborted(signal)` helper. Pass the signal to `readFile` and `writeFile`.
- A leading `@` in paths should be stripped before resolving against `ctx.cwd`.
- Preserve CRLF files by detecting the target file EOL and converting replacement text newlines to that EOL before slicing it into the file.

---

### Task 1: Add pure replacement engine and unit tests

**Files:**
- Create: `src/tools/replace-symbol.ts`
- Create: `test/replace-symbol.test.ts`

- [x] **Step 1: Write failing tests for pure helpers**

Create `test/replace-symbol.test.ts` with these imports and the first `describe` block:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../src/anchors/line-hashing.js";
import {
  applyResolvedSymbolReplacements,
  groupReplacementsByPath,
  normalizeReplacementText,
  registerReplaceSymbolTool,
  type ResolvedSymbolReplacement,
  type SymbolReplacement,
} from "../src/tools/replace-symbol.js";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-replace-symbol-"));
  tempDirs.push(dir);
  return dir;
}

function registerToolForTest(anchors = new AnchorStateManager()): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    }),
  };

  registerReplaceSymbolTool(pi as unknown as ExtensionAPI, anchors);

  expect(registeredTool).toBeDefined();
  expect(registeredTool?.name).toBe("replace_symbol");
  return registeredTool as RegisteredTool;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("replace_symbol pure helpers", () => {
  it("strips hash anchors and normalizes replacement text to the target EOL", () => {
    const text = [
      "Apple│export function next() {",
      "Berry│  return 2;",
      "Cider│}",
    ].join("\n");

    expect(normalizeReplacementText(text, "\r\n")).toBe("export function next() {\r\n  return 2;\r\n}");
  });

  it("applies non-overlapping resolved replacements from bottom to top", () => {
    const content = [
      "export function first() {",
      "  return 1;",
      "}",
      "",
      "export function second() {",
      "  return 2;",
      "}",
    ].join("\n");
    const firstStart = content.indexOf("export function first");
    const firstEnd = content.indexOf("\n\nexport function second");
    const secondStart = content.indexOf("export function second");
    const secondEnd = content.length;
    const resolved: ResolvedSymbolReplacement[] = [
      {
        replacement: { path: "sample.ts", symbol: "first", text: "export function first() {\n  return 10;\n}" },
        range: { startIndex: firstStart, endIndex: firstEnd, startLine: 0, nameText: "first" },
      },
      {
        replacement: { path: "sample.ts", symbol: "second", text: "export function second() {\n  return 20;\n}" },
        range: { startIndex: secondStart, endIndex: secondEnd, startLine: 4, nameText: "second" },
      },
    ];

    expect(applyResolvedSymbolReplacements(content, resolved, "\n")).toBe([
      "export function first() {",
      "  return 10;",
      "}",
      "",
      "export function second() {",
      "  return 20;",
      "}",
    ].join("\n"));
  });

  it("rejects overlapping resolved ranges before applying replacements", () => {
    const content = "class Service {\n  run() { return 1; }\n}\n";
    const resolved: ResolvedSymbolReplacement[] = [
      {
        replacement: { path: "sample.ts", symbol: "Service", text: "class Service {}" },
        range: { startIndex: 0, endIndex: content.length, startLine: 0, nameText: "Service" },
      },
      {
        replacement: { path: "sample.ts", symbol: "Service.run", text: "run() { return 2; }" },
        range: { startIndex: 16, endIndex: 37, startLine: 1, nameText: "run" },
      },
    ];

    expect(() => applyResolvedSymbolReplacements(content, resolved, "\n")).toThrow(
      /Overlapping replacements detected for symbols 'Service' and 'Service\.run'/,
    );
  });

  it("groups replacements by resolved absolute path while preserving display paths", () => {
    const cwd = "/tmp/project";
    const replacements: SymbolReplacement[] = [
      { path: "@src/a.ts", symbol: "a", text: "export function a() {}" },
      { path: "src/a.ts", symbol: "b", text: "export function b() {}" },
      { path: "src/b.ts", symbol: "c", text: "export function c() {}" },
    ];

    const batches = groupReplacementsByPath(replacements, cwd);

    expect(batches.map((batch) => batch.displayPath)).toEqual(["@src/a.ts", "src/b.ts"]);
    expect(batches.map((batch) => batch.replacements.map((replacement) => replacement.symbol))).toEqual([["a", "b"], ["c"]]);
  });
});
```

- [x] **Step 2: Run the new test and verify it fails because the module does not exist**

Run:

```bash
npx vitest run test/replace-symbol.test.ts
```

Expected: FAIL with an import error for `../src/tools/replace-symbol.js` or missing exported helper names.

- [x] **Step 3: Implement pure helpers in `src/tools/replace-symbol.ts`**

Create `src/tools/replace-symbol.ts` with the following initial implementation. The `registerReplaceSymbolTool` body is a minimal registration stub in this task; Task 2 replaces it with full AST-backed behavior.

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { stripHashes } from "../anchors/line-hashing.js";
import type { SymbolRange } from "../ast/ast-anchor-bridge.js";
import { ReplaceSymbolSchema } from "./schemas.js";

export interface SymbolReplacement {
  path: string;
  symbol: string;
  text: string;
  type?: string;
}

export interface FileReplacementBatch {
  absolutePath: string;
  displayPath: string;
  replacements: SymbolReplacement[];
}

export interface ResolvedSymbolReplacement {
  replacement: SymbolReplacement;
  range: SymbolRange;
}

export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.match(/\r\n|\n/)?.[0] === "\r\n" ? "\r\n" : "\n";
}

export function normalizeReplacementText(text: string, lineEnding: "\r\n" | "\n"): string {
  return stripHashes(text).replace(/\r\n|\r|\n/g, lineEnding);
}

export function groupReplacementsByPath(replacements: SymbolReplacement[], cwd: string): FileReplacementBatch[] {
  const batches = new Map<string, FileReplacementBatch>();

  for (const replacement of replacements) {
    const cleanedPath = replacement.path.replace(/^@/, "");
    const absolutePath = resolve(cwd, cleanedPath);
    const existing = batches.get(absolutePath);
    if (existing) {
      existing.replacements.push(replacement);
    } else {
      batches.set(absolutePath, {
        absolutePath,
        displayPath: replacement.path,
        replacements: [replacement],
      });
    }
  }

  return Array.from(batches.values());
}

export function applyResolvedSymbolReplacements(
  content: string,
  resolvedReplacements: ResolvedSymbolReplacement[],
  lineEnding: "\r\n" | "\n",
): string {
  const sorted = [...resolvedReplacements].sort((a, b) => a.range.startIndex - b.range.startIndex);
  for (let index = 0; index < sorted.length - 1; index++) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (current.range.endIndex > next.range.startIndex) {
      throw new Error(
        `Overlapping replacements detected for symbols '${current.replacement.symbol}' and '${next.replacement.symbol}' in ${current.replacement.path}.`,
      );
    }
  }

  let nextContent = content;
  for (const item of sorted.sort((a, b) => b.range.startIndex - a.range.startIndex)) {
    const replacementText = normalizeReplacementText(item.replacement.text, lineEnding);
    nextContent = nextContent.slice(0, item.range.startIndex) + replacementText + nextContent.slice(item.range.endIndex);
  }

  return nextContent;
}

export function registerReplaceSymbolTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  void anchors;
  pi.registerTool({
    name: "replace_symbol",
    label: "Replace Symbol",
    description: "Replace one or more AST symbols by name using tree-sitter ranges.",
    promptSnippet: "Use replace_symbol for complete function, method, class, or interface replacements.",
    promptGuidelines: [
      "Use replace_symbol when replacing an entire function, method, class, interface, or exported const/arrow function.",
      "Provide complete raw replacement code without hash anchors; anchors are stripped if accidentally included.",
    ],
    parameters: ReplaceSymbolSchema,
    async execute() {
      throw new Error("replace_symbol execution is not implemented yet");
    },
  });
}
```

- [x] **Step 4: Add the schema export used by the helper module**

Modify `src/tools/schemas.ts` by appending this schema after `GetFunctionSchema`:

```ts
export const ReplaceSymbolSchema = Type.Object({
  replacements: Type.Array(Type.Object({
    path: Type.String({ description: "Relative or absolute source file path" }),
    symbol: Type.String({ description: "Dot-separated symbol path or suffix to replace" }),
    text: Type.String({ description: "Complete replacement source for the symbol" }),
    type: Type.Optional(Type.String({ description: "Optional symbol type such as function, method, class, or interface" }))
  }))
});
```

- [x] **Step 5: Run helper tests and typecheck**

Run:

```bash
npx vitest run test/replace-symbol.test.ts
npm run typecheck
```

Expected: `test/replace-symbol.test.ts` passes the pure helper tests. `npm run typecheck` passes.

- [x] **Step 6: Commit Task 1**

Run:

```bash
git add src/tools/replace-symbol.ts src/tools/schemas.ts test/replace-symbol.test.ts
git commit -m "feat: add replace symbol engine helpers"
```

---

### Task 2: Implement registered `replace_symbol` tool behavior

**Files:**
- Modify: `src/tools/replace-symbol.ts`
- Modify: `test/replace-symbol.test.ts`

- [x] **Step 1: Add failing tool execution tests**

Append this `describe` block to `test/replace-symbol.test.ts`:

```ts
describe("replace_symbol tool", () => {
  it("replaces a TypeScript top-level function and reports stale anchors", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "export function greet(name: string) {",
      "  return `hello ${name}`;",
      "}",
      "",
      "export const untouched = 1;",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute(
      "call-1",
      {
        replacements: [
          {
            path: "sample.ts",
            symbol: "greet",
            type: "function",
            text: "export function greet(name: string) {\n  return name.toUpperCase();\n}",
          },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    );

    await expect(readFile(filePath, "utf8")).resolves.toBe([
      "export function greet(name: string) {",
      "  return name.toUpperCase();",
      "}",
      "",
      "export const untouched = 1;",
    ].join("\n"));
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain(
      "Successfully replaced symbols 'greet' in sample.ts. Any existing hash anchors for these symbols are now stale.",
    );
    expect(result.details).toEqual({ paths: ["sample.ts"], symbols: ["greet"] });
  });

  it("replaces a class method by suffix and keeps unrelated top-level code", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "class Service {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "const topLevel = 1;",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    await tool.execute(
      "call-2",
      {
        replacements: [
          {
            path: "sample.ts",
            symbol: "run",
            type: "method",
            text: "  run() {\n    return 2;\n  }",
          },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    );

    await expect(readFile(filePath, "utf8")).resolves.toBe([
      "class Service {",
      "  run() {",
      "    return 2;",
      "  }",
      "}",
      "",
      "const topLevel = 1;",
    ].join("\n"));
  });

  it("replaces a JavaScript class method", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.js");
    await writeFile(filePath, [
      "class Service {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    await tool.execute(
      "call-3",
      {
        replacements: [
          { path: "sample.js", symbol: "Service.run", text: "  run() {\n    return 3;\n  }" },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    );

    await expect(readFile(filePath, "utf8")).resolves.toBe([
      "class Service {",
      "  run() {",
      "    return 3;",
      "  }",
      "}",
    ].join("\n"));
  });

  it("replaces a Python function", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.py");
    await writeFile(filePath, [
      "def greet(name):",
      "    return f'hello {name}'",
      "",
      "value = 1",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    await tool.execute(
      "call-4",
      {
        replacements: [
          { path: "sample.py", symbol: "greet", type: "function", text: "def greet(name):\n    return name.upper()" },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    );

    await expect(readFile(filePath, "utf8")).resolves.toBe([
      "def greet(name):",
      "    return name.upper()",
      "",
      "value = 1",
    ].join("\n"));
  });

  it("returns an error and writes nothing when a symbol is missing", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    const original = "export const value = 1;\n";
    await writeFile(filePath, original, "utf8");

    const tool = registerToolForTest();
    await expect(tool.execute(
      "call-5",
      {
        replacements: [
          { path: "sample.ts", symbol: "missing", type: "function", text: "export function missing() {}" },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    )).rejects.toThrow("Symbol 'missing' of type 'function' not found in sample.ts.");
    await expect(readFile(filePath, "utf8")).resolves.toBe(original);
  });

  it("rejects overlapping replacements and writes nothing", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    const original = [
      "class Service {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
    ].join("\n");
    await writeFile(filePath, original, "utf8");

    const tool = registerToolForTest();
    await expect(tool.execute(
      "call-6",
      {
        replacements: [
          { path: "sample.ts", symbol: "Service", type: "class", text: "class Service {}" },
          { path: "sample.ts", symbol: "Service.run", type: "method", text: "  run() {\n    return 2;\n  }" },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    )).rejects.toThrow(/Overlapping replacements detected/);
    await expect(readFile(filePath, "utf8")).resolves.toBe(original);
  });

  it("preserves CRLF line endings and strips hash anchors from replacement text", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    const original = "export function greet() {\r\n  return 1;\r\n}\r\n";
    await writeFile(filePath, original, "utf8");
    const replacementLines = ["export function greet() {", "  return 2;", "}"];
    const lineAnchors = new AnchorStateManager().reconcile(filePath, replacementLines);
    const anchoredReplacement = replacementLines.map((line, index) => formatLineWithHash(line, lineAnchors[index])).join("\n");

    const tool = registerToolForTest();
    await tool.execute(
      "call-7",
      {
        replacements: [{ path: "sample.ts", symbol: "greet", text: anchoredReplacement }],
      },
      undefined,
      undefined,
      { cwd } as never,
    );

    await expect(readFile(filePath, "utf8")).resolves.toBe("export function greet() {\r\n  return 2;\r\n}\r\n");
  });

  it("includes adjacent comments in the replaced range but leaves detached comments", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "// detached",
      "",
      "/** docs */",
      "export function helper() {",
      "  return 1;",
      "}",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    await tool.execute(
      "call-8",
      {
        replacements: [
          { path: "sample.ts", symbol: "helper", text: "/** new docs */\nexport function helper() {\n  return 2;\n}" },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    );

    await expect(readFile(filePath, "utf8")).resolves.toBe([
      "// detached",
      "",
      "/** new docs */",
      "export function helper() {",
      "  return 2;",
      "}",
    ].join("\n"));
  });

  it("does not request extra UI confirmation before applying replacements", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "export function greet() {\n  return 1;\n}\n", "utf8");
    const confirm = vi.fn(() => {
      throw new Error("unexpected replace_symbol confirmation");
    });

    const tool = registerToolForTest();
    await tool.execute(
      "call-9",
      {
        replacements: [{ path: "sample.ts", symbol: "greet", text: "export function greet() {\n  return 2;\n}" }],
      },
      undefined,
      undefined,
      { cwd, hasUI: true, ui: { confirm } } as never,
    );

    expect(confirm).not.toHaveBeenCalled();
    await expect(readFile(filePath, "utf8")).resolves.toBe("export function greet() {\n  return 2;\n}\n");
  });
});
```

- [x] **Step 2: Run the tool tests and verify they fail at the execution stub**

Run:

```bash
npx vitest run test/replace-symbol.test.ts
```

Expected: pure helper tests pass and new tool tests fail with `replace_symbol execution is not implemented yet`.

- [x] **Step 3: Implement full registered tool execution**

Replace the stub implementation in `src/tools/replace-symbol.ts` with this execution structure. Keep the pure helper exports from Task 1.

```ts
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ASTAnchorBridge } from "../ast/ast-anchor-bridge.js";
```

Add this helper near the other helpers:

```ts
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("replace_symbol aborted");
}

function missingSymbolMessage(replacement: SymbolReplacement): string {
  return `Symbol '${replacement.symbol}'${replacement.type ? ` of type '${replacement.type}'` : ""} not found in ${replacement.path}.`;
}
```

Use this `execute` body inside `registerReplaceSymbolTool`:

```ts
async execute(_id, params, signal, _onUpdate, ctx) {
  const replacements = params.replacements as SymbolReplacement[] | undefined;
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error("Missing required parameter: replacements");
  }

  const batches = groupReplacementsByPath(replacements, ctx.cwd);
  const summaries: string[] = [];

  for (const batch of batches) {
    throwIfAborted(signal);
    await withFileMutationQueue(batch.absolutePath, async () => {
      throwIfAborted(signal);
      const originalContent = await readFile(batch.absolutePath, { encoding: "utf8", signal });
      const lineEnding = detectLineEnding(originalContent);
      const originalLines = originalContent.split(/\r?\n/);
      anchors.reconcile(batch.absolutePath, originalLines);

      const resolved: ResolvedSymbolReplacement[] = [];
      for (const replacement of batch.replacements) {
        throwIfAborted(signal);
        const range = await ASTAnchorBridge.getSymbolRange(batch.absolutePath, replacement.symbol, anchors, replacement.type);
        if (!range) throw new Error(missingSymbolMessage(replacement));
        resolved.push({ replacement, range });
      }

      throwIfAborted(signal);
      const finalContent = applyResolvedSymbolReplacements(originalContent, resolved, lineEnding);

      throwIfAborted(signal);
      await mkdir(dirname(batch.absolutePath), { recursive: true });
      throwIfAborted(signal);
      await writeFile(batch.absolutePath, finalContent, { encoding: "utf8", signal });
      anchors.reconcile(batch.absolutePath, finalContent.split(/\r?\n/));

      const symbolList = batch.replacements.map((replacement) => `'${replacement.symbol}'`).join(", ");
      summaries.push(`Successfully replaced symbols ${symbolList} in ${batch.displayPath}. Any existing hash anchors for these symbols are now stale.`);
    });
  }

  return {
    content: [{ type: "text", text: summaries.join("\n\n") }],
    details: {
      paths: batches.map((batch) => batch.displayPath),
      symbols: replacements.map((replacement) => replacement.symbol),
    },
  };
}
```

- [x] **Step 4: Run replace-symbol tests and typecheck**

Run:

```bash
npx vitest run test/replace-symbol.test.ts
npm run typecheck
```

Expected: all tests in `test/replace-symbol.test.ts` pass and typecheck passes.

- [x] **Step 5: Commit Task 2**

Run:

```bash
git add src/tools/replace-symbol.ts test/replace-symbol.test.ts
git commit -m "feat: implement replace symbol tool"
```

---

### Task 3: Register tool, mode activation, and prompt guidance

**Files:**
- Modify: `src/index.ts`
- Modify: `src/mode.ts`
- Modify: `src/prompt.ts`
- Modify: `src/index.test.ts`

- [x] **Step 1: Add failing integration expectations**

Modify `src/index.test.ts` expected active tool arrays so every mode includes `replace_symbol`.

In the first preferred-mode assertion, add `"replace_symbol"` after `"get_function"`:

```ts
expect(mock.activeTools).toEqual([
  "read",
  "edit",
  "custom",
  "read_file",
  "edit_file",
  "get_file_skeleton",
  "get_function",
  "replace_symbol"
]);
```

In the replacement-mode assertion, add `"replace_symbol"` after `"get_function"`:

```ts
expect(mock.activeTools).toEqual([
  "custom",
  "read_file",
  "edit_file",
  "get_file_skeleton",
  "get_function",
  "replace_symbol",
  "write",
  "bash",
  "grep",
  "find",
  "ls"
]);
```

In the additive-mode assertion, add `"replace_symbol"` after `"get_function"`:

```ts
expect(mock.activeTools).toEqual([
  "read",
  "edit",
  "custom",
  "read_file",
  "edit_file",
  "get_file_skeleton",
  "get_function",
  "replace_symbol"
]);
```

Add this assertion to the prompt guidance test:

```ts
expect(result?.systemPrompt).toContain("Use replace_symbol for whole-symbol replacements");
```

Add a new test in `src/index.test.ts` that checks tool registration count and names:

```ts
it("registers replace_symbol with the extension tools", () => {
  const mock = createMockPi(["read", "edit"]);

  diracToolsExtension(mock.pi as unknown as ExtensionAPI);

  const registeredNames = mock.pi.registerTool.mock.calls.map(([tool]) => tool.name);
  expect(registeredNames).toEqual([
    "read_file",
    "edit_file",
    "get_file_skeleton",
    "get_function",
    "replace_symbol"
  ]);
});
```

- [x] **Step 2: Run focused tests and verify failure**

Run:

```bash
npx vitest run src/index.test.ts
```

Expected: FAIL because `replace_symbol` is not registered, active, or mentioned in prompt guidance.

- [x] **Step 3: Register the tool in `src/index.ts`**

Add this import:

```ts
import { registerReplaceSymbolTool } from "./tools/replace-symbol.js";
```

Call it after `registerGetFunctionTool(...)`:

```ts
registerReplaceSymbolTool(pi, anchors);
```

- [x] **Step 4: Activate the tool in all modes in `src/mode.ts`**

Change the `diracTools` list to:

```ts
const diracTools = ["read_file", "edit_file", "get_file_skeleton", "get_function", "replace_symbol"];
```

Do not change the replacement-mode built-in filtering logic.

- [x] **Step 5: Update prompt guidance in `src/prompt.ts`**

Change the workflow list to include `replace_symbol` before `edit_file` for whole-symbol edits:

```ts
When editing existing source files, prefer this workflow:
1. Use read_file, get_file_skeleton, or get_function to understand the code and obtain stable anchors.
2. Use replace_symbol for whole-symbol replacements such as functions, methods, classes, interfaces, or exported const/arrow functions.
3. Use edit_file for targeted source edits that are smaller than a complete symbol.
4. Batch non-overlapping edits across files in one edit_file or replace_symbol call.
5. Use pi built-in edit/write only when anchors or AST symbol replacement are unnecessary, such as small config files or brand-new files.
```

Add these prompt rules below the anchor rules:

```ts
replace_symbol rules:
- replace_symbol uses a batch-only replacements array.
- Each replacement text must be complete raw code for that symbol, including export keywords, decorators, and adjacent documentation comments that should remain.
- Existing anchors for replaced symbols become stale after replace_symbol succeeds.
```

- [x] **Step 6: Run focused tests and typecheck**

Run:

```bash
npx vitest run src/index.test.ts test/replace-symbol.test.ts
npm run typecheck
```

Expected: tests pass and typecheck passes.

- [x] **Step 7: Commit Task 3**

Run:

```bash
git add src/index.ts src/mode.ts src/prompt.ts src/index.test.ts
git commit -m "feat: register replace symbol tool"
```

---

### Task 4: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-05-09-phase-2-replace-symbol.md`

- [x] **Step 1: Update README with `replace_symbol` docs**

Append this section after the existing AST tools documentation:

```md
## Symbol replacement

`replace_symbol` replaces complete AST symbols by name. Use it when replacing an entire function, method, class, interface, or exported const/arrow function.

```json
{
  "replacements": [
    {
      "path": "src/sample.ts",
      "symbol": "Service.run",
      "type": "method",
      "text": "  run() {\n    return 2;\n  }"
    }
  ]
}
```

The tool resolves symbols with tree-sitter, rejects overlapping replacements in the same file, applies accepted replacements from bottom to top, strips hash anchors from replacement text, and preserves the file's existing line-ending style where practical.

The `replacements` array is required. Unsupported languages, parser failures, and missing symbols are reported as errors; `replace_symbol` does not fall back to regex matching.
```

If the README already has a more appropriate nearby section, place this text there instead of duplicating headings.

- [x] **Step 2: Run complete verification**

Run:

```bash
npm test && npm run typecheck
```

Expected: all tests pass and typecheck passes.

Verification evidence: `npm test && npm run typecheck` passed with 10 test files / 64 tests after code-review fixes.

- [x] **Step 3: Smoke-test against a copied Dirac source file**

Run this temporary Vitest smoke from the worktree root. It copies Dirac's AST bridge, uses the registered tool directly, verifies only the copy changed, then removes the temporary smoke file:

```bash
cat > test/.replace-symbol-dirac-smoke.test.ts <<'EOF'
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { registerReplaceSymbolTool } from "../src/tools/replace-symbol.js";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("replaces a method in a copied Dirac ASTAnchorBridge source file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-replace-smoke-"));
  tempDirs.push(dir);
  const target = join(dir, "ASTAnchorBridge.ts");
  await cp("/Users/sh/Projects/dirac/src/utils/ASTAnchorBridge.ts", target);

  let registeredTool: RegisteredTool | undefined;
  registerReplaceSymbolTool({
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    }),
  } as unknown as ExtensionAPI, new AnchorStateManager());

  expect(registeredTool).toBeDefined();
  await registeredTool!.execute("smoke", {
    replacements: [{
      path: "ASTAnchorBridge.ts",
      symbol: "ASTAnchorBridge.areTypesCompatible",
      type: "method",
      text: "\tprivate static areTypesCompatible(defType: string, reqType?: string): boolean {\n\t\tif (!reqType) return true\n\t\tif (defType === reqType) return true\n\t\tconst synonyms = [\"function\", \"method\"]\n\t\treturn synonyms.includes(defType) && synonyms.includes(reqType)\n\t}",
    }],
  }, undefined, undefined, { cwd: dir } as never);

  const changed = await readFile(target, "utf8");
  expect(changed).toContain("const synonyms = [\"function\", \"method\"]");
});
EOF
npx vitest run test/.replace-symbol-dirac-smoke.test.ts
rm test/.replace-symbol-dirac-smoke.test.ts
```

Expected: the temporary smoke test passes and `test/.replace-symbol-dirac-smoke.test.ts` is removed.

Smoke evidence: `npx vitest run test/.replace-symbol-dirac-smoke.test.ts` passed and the temporary smoke file was removed.

- [x] **Step 4: Mark Task 4 checkboxes complete after verification**

After the README update, full verification, and smoke test pass, edit this plan file and change Task 4 checkboxes from `- [ ]` to `- [x]`.

- [x] **Step 5: Commit Task 4**

Run:

```bash
git add README.md docs/superpowers/plans/2026-05-09-phase-2-replace-symbol.md
git commit -m "docs: document replace symbol tool"
```

---

## Final Review Gate

After all tasks are complete:

1. Run:

```bash
npm test && npm run typecheck
```

2. Dispatch a final code review subagent to check:
   - `replace_symbol` is batch-only in schema and implementation.
   - All modes include `replace_symbol`.
   - Missing symbols and overlaps write nothing.
   - CRLF preservation works.
   - Hash anchors are stripped from replacement text.
   - Adjacent comments are included and detached comments are excluded by the existing AST bridge.
   - No Phase 3 functionality was added.

3. If approved, use the finishing-a-development-branch skill to choose merge, PR, keep-as-is, or discard.
