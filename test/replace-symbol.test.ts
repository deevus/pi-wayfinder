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
