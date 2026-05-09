# Phase 3 Find References and Rename Symbol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pi-native `find_symbol_references` and `rename_symbol` tools backed by a shared tree-sitter symbol scanner with in-memory caching.

**Architecture:** Add a focused `src/symbols/` subsystem that resolves requested paths, scans supported source files with existing tree-sitter queries, extracts definition/reference captures, and caches per-file results by `mtimeMs` and `size`. Register two pi tools that use the scanner: `find_symbol_references` for anchored read-only lookup and `rename_symbol` for prepare-before-write multi-file symbol renames.

**Tech Stack:** TypeScript, pi extension API, `typebox`, existing `web-tree-sitter` parser loader and query files, Node `fs/promises`, existing `AnchorStateManager`, existing pi `withFileMutationQueue`, Vitest.

---

## Source References

Read these before implementing:

- Spec: `docs/superpowers/specs/2026-05-09-phase-3-find-references-and-rename-symbol-design.md`
- Dirac reference lookup: `/Users/sh/Projects/dirac/src/core/task/tools/handlers/FindSymbolReferencesToolHandler.ts`
- Dirac rename: `/Users/sh/Projects/dirac/src/core/task/tools/handlers/RenameSymbolToolHandler.ts`
- Dirac index concepts: `/Users/sh/Projects/dirac/src/services/symbol-index/SymbolIndexService.ts`
- Existing scanner inputs: `src/ast/language-parser.ts`, `src/ast/queries/*.ts`
- Existing tool patterns: `src/tools/read-file.ts`, `src/tools/replace-symbol.ts`, `src/index.ts`, `src/mode.ts`, `src/prompt.ts`

Do not import from `/Users/sh/Projects/dirac`; copy/adapt concepts into this package.

## File Structure

- Create `src/symbols/symbol-cache.ts`
  - Owns session-local per-file cache.
  - Exports `SymbolCache`, `FileSymbols`, and metadata-aware get/set/delete helpers.
- Create `src/symbols/symbol-scanner.ts`
  - Owns path resolution, directory walking, exclusion rules, parser/query execution, and symbol capture extraction.
  - Exports `SymbolScanner`, `SymbolLocation`, `SymbolLocationType`, `SUPPORTED_SYMBOL_EXTENSIONS`, and pure helpers used by tests.
- Create `src/tools/find-symbol-references.ts`
  - Registers `find_symbol_references`.
  - Validates params, calls scanner, groups hits, formats anchored output.
- Create `src/tools/rename-symbol.ts`
  - Registers `rename_symbol`.
  - Validates params, calls scanner, prepares all file edits before writing, writes via mutation queues, invalidates scanner cache.
- Modify `src/tools/schemas.ts`
  - Adds `FindSymbolReferencesSchema` and `RenameSymbolSchema`.
- Modify `src/index.ts`
  - Constructs one shared `SymbolCache` and `SymbolScanner` per extension load.
  - Registers both new tools.
- Modify `src/mode.ts`
  - Adds both new tools to all modes.
- Modify `src/prompt.ts`
  - Adds concise guidance for both new tools.
- Modify `src/index.test.ts`
  - Updates registered/active tool assertions.
- Modify `README.md`
  - Documents both tools and in-memory cache behavior.
- Create `test/symbol-scanner.test.ts`
  - Tests scanner/cache behavior.
- Create `test/find-symbol-references.test.ts`
  - Tests lookup tool behavior.
- Create `test/rename-symbol.test.ts`
  - Tests rename behavior and safety.

---

### Task 1: Add symbol cache and scanner core

**Files:**
- Create: `src/symbols/symbol-cache.ts`
- Create: `src/symbols/symbol-scanner.ts`
- Create: `test/symbol-scanner.test.ts`

- [ ] **Step 1: Write failing scanner/cache tests**

Create `test/symbol-scanner.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SymbolCache } from "../src/symbols/symbol-cache.js";
import { SymbolScanner, discoverSourceFiles, isExcludedPathSegment, isSupportedSymbolPath } from "../src/symbols/symbol-scanner.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-symbol-scanner-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("symbol scanner helpers", () => {
  it("recognizes supported source files and excluded path segments", () => {
    expect(isSupportedSymbolPath("sample.ts")).toBe(true);
    expect(isSupportedSymbolPath("sample.tsx")).toBe(true);
    expect(isSupportedSymbolPath("sample.py")).toBe(true);
    expect(isSupportedSymbolPath("README.md")).toBe(false);
    expect(isExcludedPathSegment("node_modules")).toBe(true);
    expect(isExcludedPathSegment("dist")).toBe(true);
    expect(isExcludedPathSegment("src")).toBe(false);
  });

  it("discovers supported files recursively while skipping excluded directories", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "main.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(cwd, "notes.md"), "# notes\n", "utf8");
    await writeFile(join(cwd, "node_modules", "ignored.ts"), "export const ignored = 1;\n", "utf8").catch(async () => {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(cwd, "node_modules"), { recursive: true }));
      await writeFile(join(cwd, "node_modules", "ignored.ts"), "export const ignored = 1;\n", "utf8");
    });

    const files = await discoverSourceFiles(["."], cwd);

    expect(files.map((file) => file.displayPath)).toEqual(["main.ts"]);
  });
});

describe("SymbolScanner", () => {
  it("scans TypeScript definitions and references", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), [
      "export function greet(name: string) {",
      "  return name.toUpperCase();",
      "}",
      "const result = greet('Ada');",
      "",
    ].join("\n"), "utf8");

    const scanner = new SymbolScanner(new SymbolCache());
    const locations = await scanner.scanPaths(["sample.ts"], cwd);

    expect(locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayPath: "sample.ts", name: "greet", type: "definition", kind: "function", startLine: 0 }),
      expect.objectContaining({ displayPath: "sample.ts", name: "greet", type: "reference", startLine: 3 }),
    ]));
  });

  it("scans JavaScript and Python files", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.js"), "function run() { return run(); }\n", "utf8");
    await writeFile(join(cwd, "sample.py"), "def greet():\n    return greet()\n", "utf8");

    const scanner = new SymbolScanner(new SymbolCache());
    const locations = await scanner.scanPaths(["."], cwd);

    expect(locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayPath: "sample.js", name: "run", type: "definition" }),
      expect.objectContaining({ displayPath: "sample.py", name: "greet", type: "definition" }),
    ]));
  });

  it("reuses cached scan results while file metadata is unchanged and invalidates when metadata changes", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "export function first() { return first(); }\n", "utf8");

    const cache = new SymbolCache();
    const scanner = new SymbolScanner(cache);

    const first = await scanner.scanPaths(["sample.ts"], cwd);
    const second = await scanner.scanPaths(["sample.ts"], cwd);
    expect(second).toEqual(first);
    expect(cache.size()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(filePath, "export function second() { return second(); }\n", "utf8");

    const third = await scanner.scanPaths(["sample.ts"], cwd);
    expect(third).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "second", type: "definition" }),
    ]));
    expect(third).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "first", type: "definition" }),
    ]));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run test/symbol-scanner.test.ts
```

Expected: FAIL because `src/symbols/symbol-cache.ts` and `src/symbols/symbol-scanner.ts` do not exist.

- [ ] **Step 3: Implement `SymbolCache`**

Create `src/symbols/symbol-cache.ts`:

```ts
import type { SymbolLocation } from "./symbol-scanner.js";

export interface FileSymbols {
  absolutePath: string;
  displayPath: string;
  mtimeMs: number;
  size: number;
  locations: SymbolLocation[];
}

export class SymbolCache {
  private readonly entries = new Map<string, FileSymbols>();

  get(absolutePath: string, metadata: { mtimeMs: number; size: number }): FileSymbols | undefined {
    const entry = this.entries.get(absolutePath);
    if (!entry) return undefined;
    if (entry.mtimeMs !== metadata.mtimeMs || entry.size !== metadata.size) {
      this.entries.delete(absolutePath);
      return undefined;
    }
    return entry;
  }

  set(entry: FileSymbols): void {
    this.entries.set(entry.absolutePath, entry);
  }

  delete(absolutePath: string): void {
    this.entries.delete(absolutePath);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
```

- [ ] **Step 4: Implement scanner helpers and scan API**

Create `src/symbols/symbol-scanner.ts`:

```ts
import { readdir, stat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep, extname } from "node:path";
import type Parser from "web-tree-sitter";
import { loadRequiredLanguageParsers } from "../ast/language-parser.js";
import type { SymbolCache } from "./symbol-cache.js";

export type SymbolLocationType = "definition" | "reference";

export interface SymbolLocation {
  absolutePath: string;
  displayPath: string;
  name: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  type: SymbolLocationType;
  kind?: string;
}

export interface SourceFile {
  absolutePath: string;
  displayPath: string;
}

export const SUPPORTED_SYMBOL_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "py", "rs", "go", "c", "h", "cpp", "hpp", "cs", "rb", "java", "php", "swift", "kt",
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  "node_modules", ".git", ".github", ".vscode", ".cursor", ".dirac", "out", "dist", "dist-standalone", "build", "target", "bin", "obj", "__pycache__", ".venv", "venv", "env", ".env", ".cache", ".next", ".nuxt", ".svelte-kit", "coverage", "tmp", "temp", "vendor", "generated", "__generated__", "artifacts",
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock", "Gemfile.lock", "Cargo.lock", "go.sum", "poetry.lock", "mix.lock",
]);

const MAX_FILE_SIZE = 1024 * 1024;

export function isExcludedPathSegment(segment: string): boolean {
  if (EXCLUDED_PATH_SEGMENTS.has(segment)) return true;
  if (segment.startsWith(".") && !segment.startsWith(".dirac")) return true;
  return false;
}

export function isSupportedSymbolPath(filePath: string): boolean {
  if (EXCLUDED_FILES.has(filePath.split(/[\\/]/).pop() || "")) return false;
  const ext = extname(filePath).toLowerCase().slice(1);
  return SUPPORTED_SYMBOL_EXTENSIONS.has(ext);
}

export function resolveRequestedPath(requestedPath: string, cwd: string): { absolutePath: string; displayPath: string } {
  const cleaned = requestedPath.replace(/^@/, "");
  const absolutePath = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
  const displayPath = isAbsolute(cleaned) ? relative(cwd, absolutePath) || absolutePath : cleaned;
  return { absolutePath, displayPath: displayPath || "." };
}

export async function discoverSourceFiles(requestedPaths: string[], cwd: string): Promise<SourceFile[]> {
  const files = new Map<string, SourceFile>();

  async function visit(absolutePath: string): Promise<void> {
    let stats;
    try {
      stats = await stat(absolutePath);
    } catch {
      return;
    }

    const name = absolutePath.split(sep).pop() || "";
    if (isExcludedPathSegment(name)) return;

    if (stats.isDirectory()) {
      const entries = await readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (isExcludedPathSegment(entry.name)) continue;
        await visit(join(absolutePath, entry.name));
      }
      return;
    }

    if (!stats.isFile()) return;
    if (stats.size > MAX_FILE_SIZE) return;
    if (!isSupportedSymbolPath(absolutePath)) return;

    const displayPath = relative(cwd, absolutePath) || absolutePath;
    files.set(absolutePath, { absolutePath, displayPath });
  }

  for (const requestedPath of requestedPaths) {
    const resolved = resolveRequestedPath(requestedPath, cwd);
    await visit(resolved.absolutePath);
  }

  return Array.from(files.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

function captureToLocation(
  absolutePath: string,
  displayPath: string,
  capture: Parser.QueryCapture,
  fileContent: string,
): SymbolLocation | null {
  if (capture.name !== "name.reference" && !capture.name.includes("name.definition")) return null;
  const name = fileContent.slice(capture.node.startIndex, capture.node.endIndex);
  if (!name) return null;
  const isDefinition = capture.name.includes("name.definition");
  return {
    absolutePath,
    displayPath,
    name,
    startLine: capture.node.startPosition.row,
    startColumn: capture.node.startPosition.column,
    endLine: capture.node.endPosition.row,
    endColumn: capture.node.endPosition.column,
    type: isDefinition ? "definition" : "reference",
    kind: isDefinition ? capture.name.split(".").pop() : undefined,
  };
}

export class SymbolScanner {
  constructor(private readonly cache: SymbolCache) {}

  invalidate(absolutePath: string): void {
    this.cache.delete(absolutePath);
  }

  async scanPaths(requestedPaths: string[], cwd: string, signal?: AbortSignal): Promise<SymbolLocation[]> {
    const files = await discoverSourceFiles(requestedPaths, cwd);
    if (files.length === 0) return [];

    const parsers = await loadRequiredLanguageParsers(files.map((file) => file.absolutePath));
    const allLocations: SymbolLocation[] = [];

    for (const file of files) {
      if (signal?.aborted) throw signal.reason ?? new Error("symbol scan aborted");
      const stats = await stat(file.absolutePath);
      const cached = this.cache.get(file.absolutePath, { mtimeMs: stats.mtimeMs, size: stats.size });
      if (cached) {
        allLocations.push(...cached.locations);
        continue;
      }

      const ext = extname(file.absolutePath).toLowerCase().slice(1);
      const { parser, query } = parsers[ext] || {};
      if (!parser || !query) continue;

      const fileContent = await readFile(file.absolutePath, { encoding: "utf8", signal });
      let tree: Parser.Tree | null = null;
      try {
        tree = parser.parse(fileContent);
        if (!tree?.rootNode) continue;
        const captures = query.captures(tree.rootNode);
        const locations = captures
          .map((capture) => captureToLocation(file.absolutePath, file.displayPath, capture, fileContent))
          .filter((location): location is SymbolLocation => location !== null);
        this.cache.set({
          absolutePath: file.absolutePath,
          displayPath: file.displayPath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          locations,
        });
        allLocations.push(...locations);
      } finally {
        tree?.delete();
      }
    }

    return allLocations.sort((a, b) => a.displayPath.localeCompare(b.displayPath) || a.startLine - b.startLine || a.startColumn - b.startColumn);
  }
}
```

- [ ] **Step 5: Run scanner tests**

Run:

```bash
npx vitest run test/symbol-scanner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit scanner core**

```bash
git add src/symbols/symbol-cache.ts src/symbols/symbol-scanner.ts test/symbol-scanner.test.ts
git commit -m "feat: add cached symbol scanner"
```

---

### Task 2: Add `find_symbol_references`

**Files:**
- Modify: `src/tools/schemas.ts`
- Create: `src/tools/find-symbol-references.ts`
- Modify: `src/index.ts`
- Modify: `src/mode.ts`
- Modify: `src/prompt.ts`
- Modify: `src/index.test.ts`
- Create: `test/find-symbol-references.test.ts`

- [ ] **Step 1: Write failing tests for `find_symbol_references`**

Create `test/find-symbol-references.test.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { SymbolCache } from "../src/symbols/symbol-cache.js";
import { SymbolScanner } from "../src/symbols/symbol-scanner.js";
import { registerFindSymbolReferencesTool } from "../src/tools/find-symbol-references.js";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-find-refs-"));
  tempDirs.push(dir);
  return dir;
}

function registerToolForTest(): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    }),
  };
  registerFindSymbolReferencesTool(pi as unknown as ExtensionAPI, new AnchorStateManager(), new SymbolScanner(new SymbolCache()));
  expect(registeredTool).toBeDefined();
  expect(registeredTool?.name).toBe("find_symbol_references");
  return registeredTool as RegisteredTool;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("find_symbol_references tool", () => {
  it("finds definitions and references by default with hash anchors", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), [
      "export function greet(name: string) {",
      "  return name.toUpperCase();",
      "}",
      "const message = greet('Ada');",
      "",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-1", { paths: ["sample.ts"], symbols: ["greet"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0].text || "";

    expect(text).toContain("sample.ts:");
    expect(text).toMatch(/\(greet\) \w+│export function greet/);
    expect(text).toMatch(/\(greet\) \w+│const message = greet/);
  });

  it("filters definitions only and references only", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), [
      "function greet() { return 'hi'; }",
      "greet();",
      "",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    const defs = await tool.execute("call-2", { paths: ["sample.ts"], symbols: ["greet"], find_type: "definition" }, undefined, undefined, { cwd } as never);
    const refs = await tool.execute("call-3", { paths: ["sample.ts"], symbols: ["greet"], find_type: "reference" }, undefined, undefined, { cwd } as never);

    expect(defs.content[0].text).toContain("function greet");
    expect(defs.content[0].text).not.toContain("greet();");
    expect(refs.content[0].text).toContain("greet();");
    expect(refs.content[0].text).not.toContain("function greet");
  });

  it("accepts multiple symbols and merges same-line hits", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), [
      "function first() { return second(); }",
      "function second() { return first(); }",
      "const value = first() + second();",
      "",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-4", { paths: ["sample.ts"], symbols: ["first", "second"], find_type: "reference" }, undefined, undefined, { cwd } as never);
    const text = result.content[0].text || "";

    expect(text).toContain("(first, second)");
    expect(text).toContain("const value = first() + second();");
  });

  it("returns a clear no-match message", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), "export const value = 1;\n", "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-5", { paths: ["sample.ts"], symbols: ["missing"] }, undefined, undefined, { cwd } as never);

    expect(result.content[0].text).toBe("No references or definitions found for symbols: missing.");
  });

  it("rejects missing params and invalid find_type", async () => {
    const cwd = await createTempDir();
    const tool = registerToolForTest();

    await expect(tool.execute("call-6", { paths: [], symbols: ["x"] }, undefined, undefined, { cwd } as never)).rejects.toThrow("Missing required parameter: paths");
    await expect(tool.execute("call-7", { paths: ["."], symbols: [] }, undefined, undefined, { cwd } as never)).rejects.toThrow("Missing required parameter: symbols");
    await expect(tool.execute("call-8", { paths: ["."], symbols: ["x"], find_type: "all" }, undefined, undefined, { cwd } as never)).rejects.toThrow("Invalid find_type: all");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run test/find-symbol-references.test.ts
```

Expected: FAIL because `src/tools/find-symbol-references.ts` and schema exports do not exist.

- [ ] **Step 3: Add find references schema**

Modify `src/tools/schemas.ts` by adding after `GetFunctionSchema`:

```ts
export const FindSymbolReferencesSchema = Type.Object({
  paths: Type.Array(Type.String({ description: "Relative or absolute files/directories to search" })),
  symbols: Type.Array(Type.String({ description: "Exact symbol names to find" })),
  find_type: Type.Optional(Type.Union([
    Type.Literal("definition"),
    Type.Literal("reference"),
    Type.Literal("both"),
  ])),
});
```

- [ ] **Step 4: Implement `find-symbol-references.ts`**

Create `src/tools/find-symbol-references.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../anchors/line-hashing.js";
import type { SymbolLocation, SymbolLocationType, SymbolScanner } from "../symbols/symbol-scanner.js";
import { FindSymbolReferencesSchema } from "./schemas.js";

type FindType = SymbolLocationType | "both";

function validateFindType(value: unknown): FindType {
  if (value === undefined) return "both";
  if (value === "definition" || value === "reference" || value === "both") return value;
  throw new Error(`Invalid find_type: ${String(value)}`);
}

function missingMessage(findType: FindType, symbols: string[]): string {
  const label = findType === "both" ? "references or definitions" : `${findType}s`;
  return `No ${label} found for symbols: ${symbols.join(", ")}.`;
}

function filterLocations(locations: SymbolLocation[], symbols: string[], findType: FindType): SymbolLocation[] {
  const symbolSet = new Set(symbols);
  return locations.filter((location) => {
    if (!symbolSet.has(location.name)) return false;
    return findType === "both" || location.type === findType;
  });
}

async function formatLocations(locations: SymbolLocation[], anchors: AnchorStateManager): Promise<string> {
  const byFile = new Map<string, SymbolLocation[]>();
  for (const location of locations) {
    const fileLocations = byFile.get(location.absolutePath) || [];
    fileLocations.push(location);
    byFile.set(location.absolutePath, fileLocations);
  }

  const output: string[] = [];
  const sortedFiles = Array.from(byFile.entries()).sort((a, b) => {
    const aDisplay = a[1][0]?.displayPath || a[0];
    const bDisplay = b[1][0]?.displayPath || b[0];
    return aDisplay.localeCompare(bDisplay);
  });

  for (const [absolutePath, fileLocations] of sortedFiles) {
    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const lineAnchors = anchors.reconcile(absolutePath, lines);
    const merged = new Map<number, Set<string>>();

    for (const location of fileLocations.sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn)) {
      const symbols = merged.get(location.startLine) || new Set<string>();
      symbols.add(location.name);
      merged.set(location.startLine, symbols);
    }

    const displayPath = fileLocations[0]?.displayPath || absolutePath;
    output.push(`${displayPath}:`);
    for (const [lineIndex, symbols] of Array.from(merged.entries()).sort((a, b) => a[0] - b[0])) {
      output.push(`  (${Array.from(symbols).join(", ")}) ${formatLineWithHash(lines[lineIndex], lineAnchors[lineIndex]).trim()}`);
    }
    output.push("");
  }

  return output.join("\n").trim();
}

export function registerFindSymbolReferencesTool(pi: ExtensionAPI, anchors: AnchorStateManager, scanner: SymbolScanner): void {
  pi.registerTool({
    name: "find_symbol_references",
    label: "Find Symbol References",
    description: "Find exact tree-sitter definitions and references for one or more symbols across files or directories.",
    promptSnippet: "Find exact AST definitions/references of symbols across paths with anchored lines.",
    promptGuidelines: [
      "Use find_symbol_references before rename_symbol when you need to inspect where a symbol appears.",
      "Use find_symbol_references with narrow paths when possible to avoid broad symbol scans.",
    ],
    parameters: FindSymbolReferencesSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const paths = params.paths as string[] | undefined;
      const symbols = params.symbols as string[] | undefined;
      if (!Array.isArray(paths) || paths.length === 0) throw new Error("Missing required parameter: paths");
      if (!Array.isArray(symbols) || symbols.length === 0) throw new Error("Missing required parameter: symbols");
      const findType = validateFindType(params.find_type);

      const locations = await scanner.scanPaths(paths, ctx.cwd, signal);
      const hits = filterLocations(locations, symbols, findType);
      const text = hits.length > 0 ? await formatLocations(hits, anchors) : missingMessage(findType, symbols);

      return {
        content: [{ type: "text", text }],
        details: { paths, symbols, find_type: findType, matches: hits.length },
      };
    },
  });
}
```

- [ ] **Step 5: Register tool and active modes**

Modify `src/index.ts`:

```ts
import { SymbolCache } from "./symbols/symbol-cache.js";
import { SymbolScanner } from "./symbols/symbol-scanner.js";
import { registerFindSymbolReferencesTool } from "./tools/find-symbol-references.js";
```

Inside `diracToolsExtension`, after `const anchors = new AnchorStateManager();`, add:

```ts
  const symbolScanner = new SymbolScanner(new SymbolCache());
```

After `registerReplaceSymbolTool(pi, anchors);`, add:

```ts
  registerFindSymbolReferencesTool(pi, anchors, symbolScanner);
```

Modify `src/mode.ts` so `diracTools` becomes:

```ts
  const diracTools = ["read_file", "edit_file", "get_file_skeleton", "get_function", "replace_symbol", "find_symbol_references"];
```

- [ ] **Step 6: Update prompt guidance**

Modify `src/prompt.ts` by adding a `find_symbol_references` sentence to the guidance string returned by `getDiracPromptGuidance`. Preserve existing text and add:

```ts
- Use find_symbol_references to inspect exact AST definitions/references before broad rename work.
```

- [ ] **Step 7: Update index tests for registered and active tools**

Modify `src/index.test.ts` expected active tool arrays to include `"find_symbol_references"` immediately after `"replace_symbol"`.

Modify the final registered tool assertion to expect:

```ts
expect(registeredNames).toEqual([
  "read_file",
  "edit_file",
  "get_file_skeleton",
  "get_function",
  "replace_symbol",
  "find_symbol_references",
]);
```

- [ ] **Step 8: Run targeted tests**

Run:

```bash
npx vitest run test/find-symbol-references.test.ts src/index.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit find references tool**

```bash
git add src/tools/schemas.ts src/tools/find-symbol-references.ts src/index.ts src/mode.ts src/prompt.ts src/index.test.ts test/find-symbol-references.test.ts
git commit -m "feat: add find symbol references tool"
```

---

### Task 3: Add `rename_symbol` engine and tool

**Files:**
- Modify: `src/tools/schemas.ts`
- Create: `src/tools/rename-symbol.ts`
- Modify: `src/index.ts`
- Modify: `src/mode.ts`
- Modify: `src/prompt.ts`
- Modify: `src/index.test.ts`
- Create: `test/rename-symbol.test.ts`

- [ ] **Step 1: Write failing rename tests**

Create `test/rename-symbol.test.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { SymbolCache } from "../src/symbols/symbol-cache.js";
import { SymbolScanner } from "../src/symbols/symbol-scanner.js";
import { applySymbolRenameToContent, registerRenameSymbolTool, type RenameLocation } from "../src/tools/rename-symbol.js";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-rename-symbol-"));
  tempDirs.push(dir);
  return dir;
}

function registerToolForTest(scanner = new SymbolScanner(new SymbolCache())): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    }),
  };
  registerRenameSymbolTool(pi as unknown as ExtensionAPI, new AnchorStateManager(), scanner);
  expect(registeredTool).toBeDefined();
  expect(registeredTool?.name).toBe("rename_symbol");
  return registeredTool as RegisteredTool;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("rename_symbol pure helpers", () => {
  it("applies rename locations bottom-to-top and right-to-left", () => {
    const content = "const value = first() + first();\n";
    const locations: RenameLocation[] = [
      { startLine: 0, startColumn: 14, endLine: 0, endColumn: 19, displayPath: "sample.ts" },
      { startLine: 0, startColumn: 24, endLine: 0, endColumn: 29, displayPath: "sample.ts" },
    ];

    expect(applySymbolRenameToContent(content, locations, "first", "second").finalContent).toBe("const value = second() + second();\n");
  });

  it("throws when a location is stale", () => {
    const content = "const value = first();\n";
    const locations: RenameLocation[] = [
      { startLine: 0, startColumn: 14, endLine: 0, endColumn: 20, displayPath: "sample.ts" },
    ];

    expect(() => applySymbolRenameToContent(content, locations, "first", "second")).toThrow("Stale symbol location for 'first' in sample.ts at line 1.");
  });
});

describe("rename_symbol tool", () => {
  it("renames a function definition and call sites in one file", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "export function greet(name: string) {",
      "  return name.toUpperCase();",
      "}",
      "const message = greet('Ada');",
      "",
    ].join("\n"), "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-1", { paths: ["sample.ts"], existing_symbol: "greet", new_symbol: "welcome" }, undefined, undefined, { cwd } as never);

    await expect(readFile(filePath, "utf8")).resolves.toBe([
      "export function welcome(name: string) {",
      "  return name.toUpperCase();",
      "}",
      "const message = welcome('Ada');",
      "",
    ].join("\n"));
    expect(result.content[0].text).toBe("Successfully renamed symbol 'greet' to 'welcome' (2 occurrences in 1 file).");
  });

  it("renames across multiple files", async () => {
    const cwd = await createTempDir();
    const firstPath = join(cwd, "first.ts");
    const secondPath = join(cwd, "second.ts");
    await writeFile(firstPath, "export function greet() { return 'hi'; }\n", "utf8");
    await writeFile(secondPath, "import { greet } from './first';\nconsole.log(greet());\n", "utf8");

    const tool = registerToolForTest();
    await tool.execute("call-2", { paths: ["."], existing_symbol: "greet", new_symbol: "welcome" }, undefined, undefined, { cwd } as never);

    await expect(readFile(firstPath, "utf8")).resolves.toContain("function welcome");
    await expect(readFile(secondPath, "utf8")).resolves.toContain("welcome");
  });

  it("preserves CRLF line endings", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "function greet() {\r\n  return greet();\r\n}\r\n", "utf8");

    const tool = registerToolForTest();
    await tool.execute("call-3", { paths: ["sample.ts"], existing_symbol: "greet", new_symbol: "welcome" }, undefined, undefined, { cwd } as never);

    await expect(readFile(filePath, "utf8")).resolves.toBe("function welcome() {\r\n  return welcome();\r\n}\r\n");
  });

  it("returns a no-op message when no occurrences are found", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), "export const value = 1;\n", "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-4", { paths: ["sample.ts"], existing_symbol: "missing", new_symbol: "next" }, undefined, undefined, { cwd } as never);

    expect(result.content[0].text).toBe("No occurrences of symbol 'missing' found in the specified paths.");
  });

  it("rejects missing params", async () => {
    const cwd = await createTempDir();
    const tool = registerToolForTest();

    await expect(tool.execute("call-5", { paths: [], existing_symbol: "a", new_symbol: "b" }, undefined, undefined, { cwd } as never)).rejects.toThrow("Missing required parameter: paths");
    await expect(tool.execute("call-6", { paths: ["."], existing_symbol: "", new_symbol: "b" }, undefined, undefined, { cwd } as never)).rejects.toThrow("Missing required parameter: existing_symbol");
    await expect(tool.execute("call-7", { paths: ["."], existing_symbol: "a", new_symbol: "" }, undefined, undefined, { cwd } as never)).rejects.toThrow("Missing required parameter: new_symbol");
  });

  it("does not call ctx.ui.confirm", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), "function greet() { return greet(); }\n", "utf8");
    const confirm = vi.fn();

    const tool = registerToolForTest();
    await tool.execute("call-8", { paths: ["sample.ts"], existing_symbol: "greet", new_symbol: "welcome" }, undefined, undefined, { cwd, ui: { confirm } } as never);

    expect(confirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run test/rename-symbol.test.ts
```

Expected: FAIL because `src/tools/rename-symbol.ts` and schema exports do not exist.

- [ ] **Step 3: Add rename schema**

Modify `src/tools/schemas.ts` by adding after `FindSymbolReferencesSchema`:

```ts
export const RenameSymbolSchema = Type.Object({
  paths: Type.Array(Type.String({ description: "Relative or absolute files/directories to rename within" })),
  existing_symbol: Type.String({ description: "Exact symbol text to rename" }),
  new_symbol: Type.String({ description: "Replacement symbol text" }),
});
```

- [ ] **Step 4: Implement `rename-symbol.ts`**

Create `src/tools/rename-symbol.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import type { SymbolLocation, SymbolScanner } from "../symbols/symbol-scanner.js";
import { RenameSymbolSchema } from "./schemas.js";

export interface RenameLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  displayPath: string;
}

interface PreparedRenameFile {
  absolutePath: string;
  displayPath: string;
  finalContent: string;
  finalLines: string[];
  replacementCount: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("rename_symbol aborted");
}

function splitPreservingEol(content: string): { lines: string[]; eol: "\r\n" | "\n" } {
  return {
    lines: content.split(/\r?\n/),
    eol: content.match(/\r\n|\n/)?.[0] === "\r\n" ? "\r\n" : "\n",
  };
}

export function applySymbolRenameToContent(
  content: string,
  locations: RenameLocation[],
  existingSymbol: string,
  newSymbol: string,
): { finalContent: string; replacementCount: number } {
  const { lines, eol } = splitPreservingEol(content);
  const sorted = [...locations].sort((a, b) => {
    if (b.startLine !== a.startLine) return b.startLine - a.startLine;
    return b.startColumn - a.startColumn;
  });

  let replacementCount = 0;
  for (const location of sorted) {
    const line = lines[location.startLine];
    const actual = line?.slice(location.startColumn, location.endColumn);
    if (actual !== existingSymbol) {
      throw new Error(`Stale symbol location for '${existingSymbol}' in ${location.displayPath} at line ${location.startLine + 1}.`);
    }
    lines[location.startLine] = line.slice(0, location.startColumn) + newSymbol + line.slice(location.endColumn);
    replacementCount++;
  }

  return { finalContent: lines.join(eol), replacementCount };
}

async function withFileMutationQueues<T>(absolutePaths: string[], fn: () => Promise<T>): Promise<T> {
  const uniquePaths = Array.from(new Set(absolutePaths)).sort();
  const runWithQueue = async (index: number): Promise<T> => {
    if (index >= uniquePaths.length) return fn();
    return withFileMutationQueue(uniquePaths[index], () => runWithQueue(index + 1));
  };
  return runWithQueue(0);
}

function groupLocationsByFile(locations: SymbolLocation[]): Map<string, SymbolLocation[]> {
  const byFile = new Map<string, SymbolLocation[]>();
  for (const location of locations) {
    const fileLocations = byFile.get(location.absolutePath) || [];
    fileLocations.push(location);
    byFile.set(location.absolutePath, fileLocations);
  }
  return byFile;
}

export function registerRenameSymbolTool(pi: ExtensionAPI, anchors: AnchorStateManager, scanner: SymbolScanner): void {
  pi.registerTool({
    name: "rename_symbol",
    label: "Rename Symbol",
    description: "Rename all exact tree-sitter definitions and references of a symbol inside specified files or directories.",
    promptSnippet: "Rename exact AST symbol definitions and references across paths.",
    promptGuidelines: [
      "Use rename_symbol for broad symbol renames after confirming the target symbol and paths.",
      "Use find_symbol_references first when a rename could affect many files or an ambiguous symbol name.",
    ],
    parameters: RenameSymbolSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const paths = params.paths as string[] | undefined;
      const existingSymbol = params.existing_symbol as string | undefined;
      const newSymbol = params.new_symbol as string | undefined;
      if (!Array.isArray(paths) || paths.length === 0) throw new Error("Missing required parameter: paths");
      if (!existingSymbol) throw new Error("Missing required parameter: existing_symbol");
      if (!newSymbol) throw new Error("Missing required parameter: new_symbol");

      const locations = (await scanner.scanPaths(paths, ctx.cwd, signal)).filter((location) => location.name === existingSymbol);
      if (locations.length === 0) {
        return {
          content: [{ type: "text", text: `No occurrences of symbol '${existingSymbol}' found in the specified paths.` }],
          details: { paths, existing_symbol: existingSymbol, new_symbol: newSymbol, replacements: 0 },
        };
      }

      const byFile = groupLocationsByFile(locations);
      const preparedFiles: PreparedRenameFile[] = [];

      for (const [absolutePath, fileLocations] of Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        throwIfAborted(signal);
        const originalContent = await readFile(absolutePath, { encoding: "utf8", signal });
        const renameLocations = fileLocations.map((location) => ({
          startLine: location.startLine,
          startColumn: location.startColumn,
          endLine: location.endLine,
          endColumn: location.endColumn,
          displayPath: location.displayPath,
        }));
        const { finalContent, replacementCount } = applySymbolRenameToContent(originalContent, renameLocations, existingSymbol, newSymbol);
        preparedFiles.push({
          absolutePath,
          displayPath: fileLocations[0]?.displayPath || absolutePath,
          finalContent,
          finalLines: finalContent.split(/\r?\n/),
          replacementCount,
        });
      }

      await withFileMutationQueues(preparedFiles.map((file) => file.absolutePath), async () => {
        for (const file of preparedFiles) {
          throwIfAborted(signal);
          await writeFile(file.absolutePath, file.finalContent, { encoding: "utf8", signal });
          anchors.reconcile(file.absolutePath, file.finalLines);
          scanner.invalidate(file.absolutePath);
        }
      });

      const totalReplacements = preparedFiles.reduce((sum, file) => sum + file.replacementCount, 0);
      const fileLabel = preparedFiles.length === 1 ? "file" : "files";
      return {
        content: [{ type: "text", text: `Successfully renamed symbol '${existingSymbol}' to '${newSymbol}' (${totalReplacements} occurrences in ${preparedFiles.length} ${fileLabel}).` }],
        details: {
          paths,
          existing_symbol: existingSymbol,
          new_symbol: newSymbol,
          replacements: totalReplacements,
          files: preparedFiles.map((file) => file.displayPath),
        },
      };
    },
  });
}
```

- [ ] **Step 5: Register rename tool and active modes**

Modify `src/index.ts` imports:

```ts
import { registerRenameSymbolTool } from "./tools/rename-symbol.js";
```

After `registerFindSymbolReferencesTool(pi, anchors, symbolScanner);`, add:

```ts
  registerRenameSymbolTool(pi, anchors, symbolScanner);
```

Modify `src/mode.ts` so `diracTools` becomes:

```ts
  const diracTools = ["read_file", "edit_file", "get_file_skeleton", "get_function", "replace_symbol", "find_symbol_references", "rename_symbol"];
```

- [ ] **Step 6: Update prompt guidance**

Modify `src/prompt.ts` by adding:

```ts
- Use rename_symbol for exact symbol renames across files/directories; it renames definitions and references together.
```

- [ ] **Step 7: Update index tests**

Modify `src/index.test.ts` expected active tool arrays to include `"rename_symbol"` immediately after `"find_symbol_references"`.

Modify registered names assertion to expect:

```ts
expect(registeredNames).toEqual([
  "read_file",
  "edit_file",
  "get_file_skeleton",
  "get_function",
  "replace_symbol",
  "find_symbol_references",
  "rename_symbol",
]);
```

- [ ] **Step 8: Run targeted tests**

Run:

```bash
npx vitest run test/rename-symbol.test.ts src/index.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit rename tool**

```bash
git add src/tools/schemas.ts src/tools/rename-symbol.ts src/index.ts src/mode.ts src/prompt.ts src/index.test.ts test/rename-symbol.test.ts
git commit -m "feat: add rename symbol tool"
```

---

### Task 4: Add docs, broader scanner coverage, and final verification

**Files:**
- Modify: `README.md`
- Modify: `test/symbol-scanner.test.ts`
- Modify: `docs/superpowers/plans/2026-05-09-phase-3-find-references-and-rename-symbol.md`

- [ ] **Step 1: Add representative all-language scanner coverage**

Append this test to `test/symbol-scanner.test.ts`:

```ts
  it("scans representative fixtures across supported tree-sitter extensions", async () => {
    const cwd = await createTempDir();
    const fixtures: Record<string, string> = {
      "sample.ts": "export function tsName() { return tsName(); }\n",
      "sample.tsx": "export function TsxName() { return <div />; }\n",
      "sample.js": "function jsName() { return jsName(); }\n",
      "sample.jsx": "function JsxName() { return <div />; }\n",
      "sample.py": "def py_name():\n    return py_name()\n",
      "sample.go": "package main\nfunc goName() { goName() }\n",
      "sample.rs": "fn rust_name() { rust_name(); }\n",
      "sample.c": "void c_name() { c_name(); }\n",
      "sample.cpp": "void cppName() { cppName(); }\n",
      "sample.cs": "class CSharpSample { void CsName() { CsName(); } }\n",
      "sample.rb": "def ruby_name\n  ruby_name\nend\n",
      "Sample.java": "class Sample { void javaName() { javaName(); } }\n",
      "sample.php": "<?php function php_name() { php_name(); }\n",
      "sample.swift": "func swiftName() { swiftName() }\n",
      "sample.kt": "fun kotlinName() { kotlinName() }\n",
    };

    for (const [fileName, content] of Object.entries(fixtures)) {
      await writeFile(join(cwd, fileName), content, "utf8");
    }

    const scanner = new SymbolScanner(new SymbolCache());
    const locations = await scanner.scanPaths(["."], cwd);
    const definitions = locations.filter((location) => location.type === "definition").map((location) => location.displayPath);

    for (const fileName of Object.keys(fixtures)) {
      expect(definitions, `expected at least one definition in ${fileName}`).toContain(fileName);
    }
  });
```

If a grammar cannot parse one minimal fixture, replace only that fixture with a slightly more idiomatic minimal example and keep the assertion.

- [ ] **Step 2: Run scanner coverage test**

Run:

```bash
npx vitest run test/symbol-scanner.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update README docs**

Append to `README.md` after the `Symbol replacement` section:

```md
## Finding symbol references

`find_symbol_references` finds exact tree-sitter definitions and references for one or more symbols across files or directories.

```json
{
  "paths": ["src/", "test/"],
  "symbols": ["calculateTotal", "UserAccount"],
  "find_type": "both"
}
```

`find_type` can be `definition`, `reference`, or `both` (default). Results are grouped by file and include stable hash anchors for each matching line.

## Renaming symbols

`rename_symbol` renames all exact tree-sitter definitions and references of one symbol inside the requested files or directories.

```json
{
  "paths": ["src/", "test/"],
  "existing_symbol": "calculateTotal",
  "new_symbol": "calculateGrandTotal"
}
```

The tool uses an in-memory session cache for scanned files, invalidated by file `mtime` and size. It does not create a persistent symbol index. Before writing, it prepares all affected files and verifies every indexed location still matches the existing symbol; if validation fails, no file is written.
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test && npm run typecheck
```

Expected: all tests pass and TypeScript completes without errors.

- [ ] **Step 5: Update plan verification note**

At the top of this plan, below the header block, add:

```md
Verification evidence: `npm test && npm run typecheck` passed with <N> test files / <M> tests.
```

Use the actual counts from Vitest output.

- [ ] **Step 6: Commit docs and final coverage**

```bash
git add README.md test/symbol-scanner.test.ts docs/superpowers/plans/2026-05-09-phase-3-find-references-and-rename-symbol.md
git commit -m "docs: document phase 3 symbol tools"
```

- [ ] **Step 7: Request code review**

Use the requesting-code-review process. Ask the reviewer to check:

- scanner correctness and cache invalidation;
- all-mode registration;
- no persistent index/native deps;
- no extra `ctx.ui.confirm` calls;
- rename prepare-before-write behavior;
- Dirac-compatible public API shapes.

- [ ] **Step 8: Final verification before completion**

Run again after any review fixes:

```bash
npm test && npm run typecheck
```

Expected: PASS. Do not claim completion without fresh passing output.
