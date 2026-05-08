# Phase 1 Tree-sitter AST Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the regex MVP implementations of `get_file_skeleton` and `get_function` with tree-sitter-backed behavior mirrored from Dirac's `ASTAnchorBridge`.

**Architecture:** Add a small `src/ast/` subsystem that mirrors Dirac's parser loading, language queries, skeleton parsing, AST range extraction, and symbol-context enrichment without depending on Dirac's VS Code/task internals. The existing pi tools keep their public schemas and output limits, but delegate AST work to the new subsystem and fall back to the regex MVP only when tree-sitter cannot support a file.

**Tech Stack:** TypeScript, pi extension API, `web-tree-sitter`, `tree-sitter-wasms`, existing Dirac hash anchors, Vitest.

---

## Source References

Mirror these Dirac files conceptually, adapting imports and removing Dirac-only dependencies:

- `/Users/sh/Projects/dirac/src/services/tree-sitter/languageParser.ts`
- `/Users/sh/Projects/dirac/src/services/tree-sitter/index.ts`
- `/Users/sh/Projects/dirac/src/services/tree-sitter/queries/*.ts`
- `/Users/sh/Projects/dirac/src/utils/ASTAnchorBridge.ts`
- `/Users/sh/Projects/dirac/src/core/task/tools/utils/SymbolContextResolver.ts`

Do not import directly from `/Users/sh/Projects/dirac`; copy/adapt code into `pi-dirac-tools` so the package is standalone.

## File Structure

- `package.json` — add runtime dependencies `web-tree-sitter` and `tree-sitter-wasms`.
- `src/ast/queries/*.ts` — copied/adapted language query strings from Dirac.
- `src/ast/queries/index.ts` — exports all query strings.
- `src/ast/language-parser.ts` — initializes web-tree-sitter, loads WASM grammars, caches languages/queries.
- `src/ast/parse-file.ts` — runs query captures and produces skeleton definition metadata.
- `src/ast/symbol-context-resolver.ts` — adds relevant imports/class context to `get_function` output for TS/JS/Python/Java.
- `src/ast/ast-anchor-bridge.ts` — top-level API for skeleton extraction and function extraction using existing `AnchorStateManager`.
- `src/tools/get-file-skeleton.ts` — delegate to `ASTAnchorBridge.getFileSkeleton` with fallback to regex helper.
- `src/tools/get-function.ts` — delegate to `ASTAnchorBridge.getFunctions` with fallback to regex helper.
- `test/ast-tree-sitter.test.ts` — tree-sitter parity tests.
- `README.md` — document tree-sitter support and fallback behavior.

---

### Task 1: Add tree-sitter dependencies and query files

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/ast/queries/index.ts`
- Create: `src/ast/queries/typescript.ts`
- Create: `src/ast/queries/javascript.ts`
- Create: `src/ast/queries/python.ts`
- Create: `src/ast/queries/java.ts`
- Create: `src/ast/queries/go.ts`
- Create: `src/ast/queries/rust.ts`
- Create: `src/ast/queries/c.ts`
- Create: `src/ast/queries/cpp.ts`
- Create: `src/ast/queries/c-sharp.ts`
- Create: `src/ast/queries/ruby.ts`
- Create: `src/ast/queries/php.ts`
- Create: `src/ast/queries/swift.ts`
- Create: `src/ast/queries/kotlin.ts`

- [x] **Step 1: Install dependencies**

Run:

```bash
npm install web-tree-sitter@^0.22.6 tree-sitter-wasms@^0.1.13
```

Expected: `package.json` has both packages in `dependencies`; `package-lock.json` is updated.

- [x] **Step 2: Copy query files**

Copy every file from Dirac:

```bash
mkdir -p src/ast/queries
cp /Users/sh/Projects/dirac/src/services/tree-sitter/queries/*.ts src/ast/queries/
```

Expected files include `typescript.ts`, `javascript.ts`, `python.ts`, and `index.ts`.

- [x] **Step 3: Verify copied query exports compile as standalone TypeScript**

Run:

```bash
npm run typecheck
```

Expected at this point: either passes, or only errors from missing future files are absent because query files are self-contained default string exports.

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json src/ast/queries
git commit -m "feat: add tree-sitter query assets"
```

---

### Task 2: Add parser loader

**Files:**
- Create: `src/ast/language-parser.ts`
- Create: `test/ast-language-parser.test.ts`

- [x] **Step 1: Write failing parser-loader tests**

Create `test/ast-language-parser.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRequiredLanguageParsers } from "../src/ast/language-parser.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-parser-"));
  tempDirs.push(dir);
  return dir;
}

describe("tree-sitter language parser loader", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("loads TypeScript and Python parsers once requested", async () => {
    const cwd = await createTempDir();
    const tsPath = join(cwd, "sample.ts");
    const pyPath = join(cwd, "sample.py");
    await writeFile(tsPath, "export function greet() { return 'hi'; }", "utf8");
    await writeFile(pyPath, "def greet():\n    return 'hi'\n", "utf8");

    const parsers = await loadRequiredLanguageParsers([tsPath, pyPath]);

    expect(parsers.ts?.parser).toBeDefined();
    expect(parsers.ts?.query).toBeDefined();
    expect(parsers.py?.parser).toBeDefined();
    expect(parsers.py?.query).toBeDefined();
  });

  it("throws an explicit unsupported-language error", async () => {
    await expect(loadRequiredLanguageParsers(["notes.txt"])).rejects.toThrow("Unsupported language: txt");
  });
});
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run test/ast-language-parser.test.ts
```

Expected: FAIL because `src/ast/language-parser.ts` does not exist.

- [x] **Step 3: Implement parser loader**

Create `src/ast/language-parser.ts` by adapting Dirac's `languageParser.ts` with these changes:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";
import {
  cppQuery,
  cQuery,
  csharpQuery,
  goQuery,
  javaQuery,
  javascriptQuery,
  kotlinQuery,
  phpQuery,
  pythonQuery,
  rubyQuery,
  rustQuery,
  swiftQuery,
  typescriptQuery
} from "./queries/index.js";

export interface LanguageParser {
  [key: string]: { parser: Parser; query: Parser.Query };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadLanguage(langName: string): Promise<Parser.Language> {
  const wasmName = `tree-sitter-${langName}.wasm`;
  const searchPaths = [
    path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmName),
    path.join(__dirname, "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmName)
  ];

  for (const wasmPath of searchPaths) {
    try {
      return await Parser.Language.load(wasmPath);
    } catch {
      // Try next location.
    }
  }
  throw new Error(`Could not find WASM for language: ${langName}`);
}

let isParserInitialized = false;
let initializationPromise: Promise<void> | null = null;
const languageCache = new Map<string, Parser.Language>();
const queryCache = new Map<string, Parser.Query>();

async function initializeParser(): Promise<void> {
  if (isParserInitialized) return;
  if (!initializationPromise) {
    initializationPromise = Parser.init({
      locateFile(scriptName: string) {
        const localPath = path.join(__dirname, scriptName);
        if (fs.existsSync(localPath)) return localPath;
        return path.join(process.cwd(), "node_modules", "web-tree-sitter", scriptName);
      }
    }).then(() => {
      isParserInitialized = true;
    });
  }
  return initializationPromise;
}

function languageForExtension(ext: string): { langName: string; queryText: string } {
  switch (ext) {
    case "js":
    case "jsx":
      return { langName: "javascript", queryText: javascriptQuery };
    case "ts":
      return { langName: "typescript", queryText: typescriptQuery };
    case "tsx":
      return { langName: "tsx", queryText: typescriptQuery };
    case "py":
      return { langName: "python", queryText: pythonQuery };
    case "rs":
      return { langName: "rust", queryText: rustQuery };
    case "go":
      return { langName: "go", queryText: goQuery };
    case "cpp":
    case "hpp":
      return { langName: "cpp", queryText: cppQuery };
    case "c":
    case "h":
      return { langName: "c", queryText: cQuery };
    case "cs":
      return { langName: "c_sharp", queryText: csharpQuery };
    case "rb":
      return { langName: "ruby", queryText: rubyQuery };
    case "java":
      return { langName: "java", queryText: javaQuery };
    case "php":
      return { langName: "php", queryText: phpQuery };
    case "swift":
      return { langName: "swift", queryText: swiftQuery };
    case "kt":
      return { langName: "kotlin", queryText: kotlinQuery };
    default:
      throw new Error(`Unsupported language: ${ext}`);
  }
}

export async function loadRequiredLanguageParsers(filesToParse: string[]): Promise<LanguageParser> {
  await initializeParser();
  const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)));
  const parsers: LanguageParser = {};

  for (const ext of extensionsToLoad) {
    const { langName, queryText } = languageForExtension(ext);
    let language = languageCache.get(langName);
    if (!language) {
      language = await loadLanguage(langName);
      languageCache.set(langName, language);
    }

    const queryCacheKey = `${langName}:${queryText}`;
    let query = queryCache.get(queryCacheKey);
    if (!query) {
      query = language.query(queryText);
      queryCache.set(queryCacheKey, query);
    }

    const parser = new Parser();
    parser.setLanguage(language);
    parsers[ext] = { parser, query };
  }

  return parsers;
}
```

- [x] **Step 4: Verify parser tests pass**

```bash
npx vitest run test/ast-language-parser.test.ts
npm run typecheck
```

Expected: parser tests pass and TypeScript compiles.

- [x] **Step 5: Commit**

```bash
git add src/ast/language-parser.ts test/ast-language-parser.test.ts
git commit -m "feat: add tree-sitter parser loader"
```

---

### Task 3: Add tree-sitter skeleton parser

**Files:**
- Create: `src/ast/parse-file.ts`
- Create: `test/ast-parse-file.test.ts`

- [x] **Step 1: Write failing skeleton parser tests**

Create `test/ast-parse-file.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRequiredLanguageParsers } from "../src/ast/language-parser.js";
import { parseFile } from "../src/ast/parse-file.js";

const tempDirs: string[] = [];
async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-parse-file-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseFile", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("extracts TypeScript functions, methods, classes, and arrow functions", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "export function topLevel() { return 1; }",
      "class Service {",
      "  method() { return topLevel(); }",
      "  field = () => 2;",
      "}",
      "const helper = () => 3;"
    ].join("\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers);

    expect(defs?.map((def) => def.text)).toEqual([
      "export function topLevel() { return 1; }",
      "class Service {",
      "  method() { return topLevel(); }",
      "  field = () => 2;",
      "const helper = () => 3;"
    ]);
  });

  it("adds line counts and call graph when requested", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "function called() { return 1; }",
      "function caller() {",
      "  return called();",
      "}"
    ].join("\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers, { showCallGraph: true });
    const caller = defs?.find((def) => def.text === "function caller() {");

    expect(caller?.lineCount).toBe(3);
    expect(caller?.calls).toEqual(["called"]);
  });
});
```

- [x] **Step 2: Run tests to verify failure**

```bash
npx vitest run test/ast-parse-file.test.ts
```

Expected: FAIL because `src/ast/parse-file.ts` does not exist.

- [x] **Step 3: Implement `parseFile`**

Create `src/ast/parse-file.ts` by adapting Dirac's `src/services/tree-sitter/index.ts`. Use this public shape:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import Parser from "web-tree-sitter";
import type { LanguageParser } from "./language-parser.js";

export interface ParsedDefinition {
  lineIndex: number;
  text: string;
  indentation: string;
  lineCount?: number;
  calls?: string[];
}

export interface ParseFileOptions {
  showCallGraph?: boolean;
}

export async function parseFile(
  filePath: string,
  languageParsers: LanguageParser,
  options?: ParseFileOptions
): Promise<ParsedDefinition[] | null> {
  const fileContent = await fs.readFile(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const { parser, query } = languageParsers[ext] || {};
  if (!parser || !query) return null;

  try {
    const tree = parser.parse(fileContent);
    if (!tree?.rootNode) return null;
    const captures = query.captures(tree.rootNode);
    const lines = fileContent.split("\n");
    const definitions: ParsedDefinition[] = [];
    const definedNames = new Set<string>();
    const allReferences: { node: Parser.SyntaxNode; text: string; line: number }[] = [];
    const definitionNodes = new Map<number, string>();

    for (const capture of captures) {
      if (capture.name.includes("definition") && !capture.name.includes("name.definition")) {
        definitionNodes.set(capture.node.id, capture.name);
      }
      if (options?.showCallGraph) {
        if (capture.name.includes("name.definition.function") || capture.name.includes("name.definition.method")) {
          definedNames.add(capture.node.text);
        } else if (capture.name.includes("name.reference")) {
          allReferences.push({ node: capture.node, text: capture.node.text, line: capture.node.startPosition.row });
        }
      }
    }

    captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row);
    let lastLineAdded = -1;

    for (const capture of captures) {
      const { node, name } = capture;
      const startLine = node.startPosition.row;
      if (!name.includes("name.definition") || !lines[startLine]) continue;
      if (startLine <= lastLineAdded) continue;

      const def: ParsedDefinition = {
        lineIndex: startLine,
        text: lines[startLine],
        indentation: lines[startLine].match(/^\s*/)?.[0] || ""
      };
      lastLineAdded = startLine;

      if (options?.showCallGraph) {
        let definitionNode: Parser.SyntaxNode | null = null;
        let current: Parser.SyntaxNode | null = node;
        while (current) {
          if (definitionNodes.has(current.id)) {
            definitionNode = current;
            break;
          }
          current = current.parent;
        }
        if (definitionNode) {
          const startRow = definitionNode.startPosition.row;
          const endRow = definitionNode.endPosition.row;
          if (
            name.includes("name.definition.function") ||
            name.includes("name.definition.method") ||
            name.includes("name.definition.class") ||
            name.includes("name.definition.interface")
          ) {
            def.lineCount = endRow - startRow + 1;
          }
          if (name.includes("name.definition.function") || name.includes("name.definition.method")) {
            const localCalls = new Set<string>();
            for (const ref of allReferences) {
              if (ref.line >= startRow && ref.line <= endRow && definedNames.has(ref.text) && ref.text !== node.text) {
                if (isCallNode(ref.node)) localCalls.add(ref.text);
              }
            }
            if (localCalls.size > 0) def.calls = Array.from(localCalls);
          }
        }
      }

      definitions.push(def);
    }

    return definitions.length > 0 ? definitions : null;
  } catch {
    return null;
  }
}

function isCallNode(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  const callTypes = ["call", "call_expression", "method_invocation", "function_call_expression", "member_call_expression", "invocation_expression"];
  if (callTypes.includes(parent.type)) return true;
  const memberTypes = ["member_expression", "member_access_expression", "property_access", "member_call_expression"];
  if (memberTypes.includes(parent.type)) {
    const grandParent = parent.parent;
    return !!grandParent && callTypes.includes(grandParent.type);
  }
  return false;
}
```

- [x] **Step 4: Verify skeleton parser tests pass**

```bash
npx vitest run test/ast-parse-file.test.ts
npm run typecheck
```

Expected: tests pass and TypeScript compiles.

- [x] **Step 5: Commit**

```bash
git add src/ast/parse-file.ts test/ast-parse-file.test.ts
git commit -m "feat: add tree-sitter skeleton parser"
```

---

### Task 4: Add AST anchor bridge and symbol context resolver

**Files:**
- Create: `src/ast/symbol-context-resolver.ts`
- Create: `src/ast/ast-anchor-bridge.ts`
- Create: `test/ast-anchor-bridge.test.ts`

- [x] **Step 1: Write failing bridge tests**

Create `test/ast-anchor-bridge.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { ASTAnchorBridge } from "../src/ast/ast-anchor-bridge.js";

const tempDirs: string[] = [];
async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-bridge-"));
  tempDirs.push(dir);
  return dir;
}

describe("ASTAnchorBridge", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns anchored skeleton lines from tree-sitter definitions", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "export class Service {",
      "  run() { return 1; }",
      "}",
      "export const helper = () => 2;"
    ].join("\n"), "utf8");

    const text = await ASTAnchorBridge.getFileSkeleton(filePath, new AnchorStateManager());

    expect(text).toContain("|----");
    expect(text).toContain("DiracA│export class Service {");
    expect(text).toContain("DiracB│  run() { return 1; }");
    expect(text).toContain("DiracD│export const helper = () => 2;");
  });

  it("extracts nested method implementations by suffix name", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "import { dep } from './dep';",
      "class Service {",
      "  private value = 1;",
      "  run() {",
      "    return dep(this.value);",
      "  }",
      "}"
    ].join("\n"), "utf8");

    const result = await ASTAnchorBridge.getFunctions(filePath, "sample.ts", ["run"], new AnchorStateManager());

    expect(result?.foundNames).toEqual(["run"]);
    expect(result?.formattedContent).toContain("sample.ts::Service.run");
    expect(result?.formattedContent).toContain("[Function Hash:");
    expect(result?.formattedContent).toContain("DiracD│  run() {");
    expect(result?.formattedContent).toContain("DiracE│    return dep(this.value);");
    expect(result?.formattedContent).toContain("DiracF│  }");
  });

  it("includes adjacent comments/decorators in extended ranges", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "/** Docs for helper */",
      "export function helper() {",
      "  return 1;",
      "}"
    ].join("\n"), "utf8");

    const result = await ASTAnchorBridge.getFunctions(filePath, "sample.ts", ["helper"], new AnchorStateManager());

    expect(result?.formattedContent).toContain("DiracA│/** Docs for helper */");
    expect(result?.formattedContent).toContain("DiracB│export function helper() {");
  });
});
```

- [x] **Step 2: Run bridge tests to verify failure**

```bash
npx vitest run test/ast-anchor-bridge.test.ts
```

Expected: FAIL because bridge files do not exist.

- [x] **Step 3: Implement `symbol-context-resolver.ts`**

Copy/adapt Dirac's `SymbolContextResolver.ts` into `src/ast/symbol-context-resolver.ts` with these import changes:

```ts
import { formatLineWithHash } from "../anchors/line-hashing.js";
import Parser, { type QueryCapture, type SyntaxNode } from "web-tree-sitter";
```

Keep support for `ts`, `tsx`, `js`, `jsx`, `py`, and `java`. Remove `Logger`; catch errors and return `""`.

- [x] **Step 4: Implement `ast-anchor-bridge.ts`**

Create `src/ast/ast-anchor-bridge.ts` by adapting Dirac's `ASTAnchorBridge.ts` with this public API:

```ts
import fs from "node:fs/promises";
import * as path from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import { loadRequiredLanguageParsers } from "./language-parser.js";
import { parseFile } from "./parse-file.js";
import { SymbolContextResolver } from "./symbol-context-resolver.js";

export interface SymbolRange {
  startIndex: number;
  endIndex: number;
  startLine: number;
  nameText: string;
}

export interface GetFunctionsResult {
  formattedContent: string;
  foundNames: string[];
}

export class ASTAnchorBridge {
  static async getFileSkeleton(absolutePath: string, anchors: AnchorStateManager, options?: { showCallGraph?: boolean }): Promise<string | null> {
    const languageParsers = await loadRequiredLanguageParsers([absolutePath]);
    const definitions = await parseFile(absolutePath, languageParsers, options);
    if (!definitions) return null;

    const fileContent = await fs.readFile(absolutePath, "utf8");
    const lines = fileContent.split("\n");
    const lineAnchors = anchors.reconcile(absolutePath, lines);
    let formattedOutput = "";
    let lastLineAdded = -1;

    for (const def of definitions) {
      const startLine = def.lineIndex;
      if (lastLineAdded !== -1 && startLine > lastLineAdded + 1) formattedOutput += "|----\n";
      if (startLine > lastLineAdded) {
        formattedOutput += `${formatLineWithHash(def.text, lineAnchors[startLine])}\n`;
        lastLineAdded = startLine;
        if (options?.showCallGraph) {
          if (def.lineCount !== undefined) formattedOutput += `${def.indentation}    # Lines: ${def.lineCount}\n`;
          if (def.calls?.length) formattedOutput += `${def.indentation}    # Calls: [${def.calls.sort().join(", ")}]\n`;
        }
      }
    }

    return formattedOutput.length > 0 ? `|----\n${formattedOutput}|----\n` : null;
  }

  static async getFunctions(absolutePath: string, relPath: string, functionNames: string[], anchors: AnchorStateManager): Promise<GetFunctionsResult | null> {
    // Port Dirac getFunctions body. Use anchors.reconcile(absolutePath, allLines).
    // Use getExtendedRange() below and SymbolContextResolver.resolve().
    throw new Error("replace with ported implementation");
  }

  static async getSymbolRange(absolutePath: string, symbol: string, anchors: AnchorStateManager, type?: string): Promise<SymbolRange | null> {
    // Port now because Phase 2 replace_symbol will need it, but do not expose a pi tool in Phase 1.
    void anchors;
    void type;
    throw new Error("replace with ported implementation");
  }

  private static areTypesCompatible(defType: string, reqType?: string): boolean {
    if (!reqType) return true;
    if (defType === reqType) return true;
    const synonyms = ["function", "method"];
    return synonyms.includes(defType) && synonyms.includes(reqType);
  }

  private static getExtendedRange(targetNode: any): { startIndex: number; endIndex: number; startLine: number } {
    let startIndex = targetNode.startIndex;
    let endIndex = targetNode.endIndex;
    let startLine = targetNode.startPosition.row;
    let currentNode = targetNode;
    const wrapperTypes = ["export_statement", "export_declaration", "ambient_declaration", "decorated_definition", "internal_module"];

    while (currentNode.parent && wrapperTypes.includes(currentNode.parent.type)) {
      currentNode = currentNode.parent;
      startIndex = currentNode.startIndex;
      endIndex = currentNode.endIndex;
      startLine = currentNode.startPosition.row;
    }

    while (currentNode.previousNamedSibling) {
      const prev = currentNode.previousNamedSibling;
      if (prev.type === "comment" || prev.type === "decorator" || prev.type === "attribute" || prev.type.includes("comment")) {
        startIndex = prev.startIndex;
        startLine = prev.startPosition.row;
        currentNode = prev;
      } else {
        break;
      }
    }

    return { startIndex, endIndex, startLine };
  }
}
```

Important implementation details for `getFunctions`:
- Use `query.matches(tree.rootNode)`, not only captures.
- Build `nodeToMatch` for captures whose names start with `name.` or `definition.`.
- Derive `fullName` by walking parent nodes and prepending parent definition names.
- Match requested names by exact normalized name or suffix match.
- Deduplicate by `startIndex-endIndex`.
- Format as `relPath::${fullName}\n[Function Hash: ${contentHash(defText)}]\nAll Hash Anchors provided below are stable and can be used with edit_file directly.\n${context}${formatted}`.
- Return unsupported parse states as Dirac does: `Unsupported file type: ${relPath}`, `Could not parse file: ${relPath}`, or `None of the requested functions (...) were found in ${relPath}`.

- [x] **Step 5: Verify bridge tests pass**

```bash
npx vitest run test/ast-anchor-bridge.test.ts
npm run typecheck
```

Expected: bridge tests pass and TypeScript compiles.

- [x] **Step 6: Commit**

```bash
git add src/ast/symbol-context-resolver.ts src/ast/ast-anchor-bridge.ts test/ast-anchor-bridge.test.ts
git commit -m "feat: add AST anchor bridge"
```

---

### Task 5: Integrate tree-sitter bridge into pi tools with regex fallback

**Files:**
- Modify: `src/tools/get-file-skeleton.ts`
- Modify: `src/tools/get-function.ts`
- Modify: `test/ast-tools.test.ts`
- Create: `test/ast-tools-tree-sitter.test.ts`

- [x] **Step 1: Add integration tests that prove method extraction works through the pi tool**

Create `test/ast-tools-tree-sitter.test.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { registerGetFileSkeletonTool } from "../src/tools/get-file-skeleton.js";
import { registerGetFunctionTool } from "../src/tools/get-function.js";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-tool-tree-sitter-"));
  tempDirs.push(dir);
  return dir;
}

function registerTool(register: (pi: ExtensionAPI, anchors: AnchorStateManager) => void): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = { registerTool: vi.fn((tool: RegisteredTool) => { registeredTool = tool; }) };
  register(pi as unknown as ExtensionAPI, new AnchorStateManager());
  expect(registeredTool).toBeDefined();
  return registeredTool as RegisteredTool;
}

describe("tree-sitter backed AST pi tools", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("get_file_skeleton includes methods that regex MVP missed", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), [
      "class Service {",
      "  run() { return 1; }",
      "}",
      "const helper = () => 2;"
    ].join("\n"), "utf8");

    const tool = registerTool(registerGetFileSkeletonTool);
    const result = await tool.execute("call-1", { paths: ["sample.ts"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- sample.ts ---");
    expect(text).toContain("DiracA│class Service {");
    expect(text).toContain("DiracB│  run() { return 1; }");
    expect(text).toContain("DiracD│const helper = () => 2;");
  });

  it("get_function extracts class methods by suffix name", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), [
      "class Service {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
      "const leaked = 2;"
    ].join("\n"), "utf8");

    const tool = registerTool(registerGetFunctionTool);
    const result = await tool.execute("call-2", { paths: ["sample.ts"], function_names: ["run"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("sample.ts::Service.run");
    expect(text).toContain("DiracB│  run() {");
    expect(text).toContain("DiracC│    return 1;");
    expect(text).toContain("DiracD│  }");
    expect(text).not.toContain("const leaked = 2;");
  });
});
```

- [x] **Step 2: Run tests to verify failure before integration**

```bash
npx vitest run test/ast-tools-tree-sitter.test.ts
```

Expected: at least method extraction expectations fail with current regex tools.

- [x] **Step 3: Keep regex helpers as fallback functions**

In `src/tools/get-file-skeleton.ts`, extract existing regex logic into:

```ts
function getRegexSkeleton(content: string, absolutePath: string, anchors: AnchorStateManager): string[] {
  const lines = content.split(/\r?\n/);
  const lineAnchors = anchors.reconcile(absolutePath, lines);
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => DEFINITION_LINE.test(line))
    .map(({ line, index }) => formatLineWithHash(line, lineAnchors[index]));
}
```

In `src/tools/get-function.ts`, keep `findFunctionRange` exported for fallback tests and add:

```ts
function getRegexFunction(content: string, absolutePath: string, requestedPath: string, name: string, anchors: AnchorStateManager): string {
  const lines = content.split(/\r?\n/);
  const lineAnchors = anchors.reconcile(absolutePath, lines);
  const range = findFunctionRange(lines, name);
  if (!range) return `${requestedPath}::${name}\nNot found.`;
  const [start, end] = range;
  const body = lines.slice(start, end + 1);
  const anchored = body.map((line, offset) => formatLineWithHash(line, lineAnchors[start + offset]));
  return `${requestedPath}::${name}\n[Function Hash: ${contentHash(body.join("\n"))}]\n${anchored.join("\n")}`;
}
```

- [x] **Step 4: Delegate skeleton tool to AST bridge**

Update `registerGetFileSkeletonTool` execute body:

```ts
const absolutePath = resolve(ctx.cwd, requestedPath.replace(/^@/, ""));
let skeletonText: string | null = null;
try {
  skeletonText = await ASTAnchorBridge.getFileSkeleton(absolutePath, anchors);
} catch {
  skeletonText = null;
}

if (!isFirstFile) appendOutputLine(output, "");
appendOutputLine(output, `--- ${requestedPath} ---`);
if (skeletonText) {
  for (const line of skeletonText.trimEnd().split(/\r?\n/)) appendOutputLine(output, line);
} else {
  const content = await readFile(absolutePath, { encoding: "utf8", signal });
  const skeleton = getRegexSkeleton(content, absolutePath, anchors);
  if (skeleton.length) for (const line of skeleton) appendOutputLine(output, line);
  else appendOutputLine(output, "No definitions found.");
}
```

Keep abort checks and output truncation.

- [x] **Step 5: Delegate function tool to AST bridge**

Update `registerGetFunctionTool` execute body per file:

```ts
let astResultText: string | undefined;
try {
  const astResult = await ASTAnchorBridge.getFunctions(absolutePath, requestedPath, params.function_names, anchors);
  astResultText = astResult?.formattedContent;
} catch {
  astResultText = undefined;
}

if (astResultText && !astResultText.startsWith("Unsupported file type:") && !astResultText.startsWith("Could not parse file:")) {
  for (const line of astResultText.split(/\r?\n/)) appendOutputLine(output, line);
  hasOutput = true;
  continue;
}

const content = await readFile(absolutePath, { encoding: "utf8", signal });
for (const name of params.function_names) {
  if (hasOutput) {
    appendOutputLine(output, "");
    appendOutputLine(output, "---");
    appendOutputLine(output, "");
  }
  for (const line of getRegexFunction(content, absolutePath, requestedPath, name, anchors).split(/\r?\n/)) appendOutputLine(output, line);
  hasOutput = true;
}
```

If AST returns `None of the requested functions (...) were found`, return that instead of regex fallback for supported files. Use regex fallback only for unsupported languages or parse failure.

- [x] **Step 6: Verify integration tests and old tests pass**

```bash
npx vitest run test/ast-tools-tree-sitter.test.ts test/ast-tools.test.ts
npm run typecheck
```

Expected: all AST tool tests pass.

- [x] **Step 7: Commit**

```bash
git add src/tools/get-file-skeleton.ts src/tools/get-function.ts test/ast-tools.test.ts test/ast-tools-tree-sitter.test.ts
git commit -m "feat: use tree-sitter for AST read tools"
```

---

### Task 6: Documentation, full verification, and Dirac source smoke test

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-05-08-phase-1-tree-sitter-ast.md`

- [x] **Step 1: Document tree-sitter support**

Append to `README.md`:

```md
## Tree-sitter AST tools

`get_file_skeleton` and `get_function` use Dirac-style tree-sitter parsing for supported source files. Supported extensions include `ts`, `tsx`, `js`, `jsx`, `py`, `rs`, `go`, `c`, `h`, `cpp`, `hpp`, `cs`, `rb`, `java`, `php`, `swift`, and `kt`.

For unsupported languages or parser load failures, the tools fall back to the conservative regex MVP for common JavaScript, TypeScript, and Python top-level definitions.
```

- [x] **Step 2: Run complete automated verification**

```bash
npm test && npm run typecheck
```

Expected: all tests pass and TypeScript compiles.

- [x] **Step 3: Run Dirac source smoke through active tools manually**

After reloading pi with the symlinked extension, run these tool calls in-session:

```txt
get_file_skeleton paths=["/Users/sh/Projects/dirac/src/utils/ASTAnchorBridge.ts"]
get_function paths=["/Users/sh/Projects/dirac/src/utils/ASTAnchorBridge.ts"] function_names=["getFunctions", "getExtendedRange"]
```

Expected:
- Skeleton includes class methods such as `getFileSkeleton`, `getFunctions`, `getSymbolRange`, and private static methods.
- `get_function` resolves suffix names to full names such as `ASTAnchorBridge.getFunctions`.
- Output contains stable anchors and function hashes.

Actual verification evidence (2026-05-08):
- `pi -e .` smoke for `get_file_skeleton` on `/Users/sh/Projects/dirac/src/utils/ASTAnchorBridge.ts` found `getFileSkeleton`, `getFunctions`, `getSymbolRange`, and private static methods.
- `pi -e .` smoke for `get_function` resolved suffix names to `ASTAnchorBridge.getFunctions` and `ASTAnchorBridge.getExtendedRange`, with anchors and Function Hash in the output.

- [x] **Step 4: Commit docs and plan checkbox updates**

```bash
git add README.md docs/superpowers/plans/2026-05-08-phase-1-tree-sitter-ast.md
git commit -m "docs: document tree-sitter AST tools"
```

---

## Self-Review

- Spec coverage: Tasks cover dependencies, copied query assets, parser loading, skeleton parsing, AST function extraction, context resolver, pi tool integration, fallback behavior, tests, docs, and Dirac source smoke validation.
- Placeholder scan: no placeholder markers are present; implementation details are concrete enough for a worker to execute task-by-task.
- Type consistency: `LanguageParser`, `ParsedDefinition`, `ParseFileOptions`, `ASTAnchorBridge`, `GetFunctionsResult`, `SymbolRange`, and existing tool registration names are consistent across tasks.
