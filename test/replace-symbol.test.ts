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
    expect(result.details).toMatchObject({ paths: ["sample.ts"], symbols: ["greet"] });
    expect(result.details?.diff).toContain("+2   return name.toUpperCase();");
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

  it("writes nothing in earlier files when a later file is missing a symbol", async () => {
    const cwd = await createTempDir();
    const firstPath = join(cwd, "first.ts");
    const secondPath = join(cwd, "second.ts");
    const firstOriginal = "export function first() {\n  return 1;\n}\n";
    const secondOriginal = "export const value = 2;\n";
    await writeFile(firstPath, firstOriginal, "utf8");
    await writeFile(secondPath, secondOriginal, "utf8");

    const tool = registerToolForTest();
    await expect(tool.execute(
      "call-5b",
      {
        replacements: [
          { path: "first.ts", symbol: "first", type: "function", text: "export function first() {\n  return 10;\n}" },
          { path: "second.ts", symbol: "missing", type: "function", text: "export function missing() {}" },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    )).rejects.toThrow("Symbol 'missing' of type 'function' not found in second.ts.");

    await expect(readFile(firstPath, "utf8")).resolves.toBe(firstOriginal);
    await expect(readFile(secondPath, "utf8")).resolves.toBe(secondOriginal);
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

  it("writes nothing in earlier files when a later file has overlapping replacements", async () => {
    const cwd = await createTempDir();
    const firstPath = join(cwd, "first.ts");
    const secondPath = join(cwd, "second.ts");
    const firstOriginal = "export function first() {\n  return 1;\n}\n";
    const secondOriginal = [
      "class Service {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
    ].join("\n");
    await writeFile(firstPath, firstOriginal, "utf8");
    await writeFile(secondPath, secondOriginal, "utf8");

    const tool = registerToolForTest();
    await expect(tool.execute(
      "call-6b",
      {
        replacements: [
          { path: "first.ts", symbol: "first", type: "function", text: "export function first() {\n  return 10;\n}" },
          { path: "second.ts", symbol: "Service", type: "class", text: "class Service {}" },
          { path: "second.ts", symbol: "Service.run", type: "method", text: "  run() {\n    return 2;\n  }" },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    )).rejects.toThrow(/Overlapping replacements detected/);

    await expect(readFile(firstPath, "utf8")).resolves.toBe(firstOriginal);
    await expect(readFile(secondPath, "utf8")).resolves.toBe(secondOriginal);
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

  it("returns unified diff details", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "function greet() {\n  return 'hi';\n}\n", "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute(
      "call-diff",
      {
        replacements: [
          {
            path: "sample.ts",
            symbol: "greet",
            type: "function",
            text: "function greet() {\n  return 'hello';\n}",
          },
        ],
      },
      undefined,
      undefined,
      { cwd } as never,
    );

    expect(result.details?.diff).toContain("-2   return 'hi';");
    expect(result.details?.diff).toContain("+2   return 'hello';");
    expect(result.details?.diffs).toEqual([
      expect.objectContaining({ path: "sample.ts", firstChangedLine: 2 }),
    ]);
  });
});
