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
  const dir = await mkdtemp(join(tmpdir(), "pi-wayfinder-rename-symbol-"));
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
    await expect(tool.execute("call-7", { paths: ["."], existing_symbol: "a" }, undefined, undefined, { cwd } as never)).rejects.toThrow("Missing required parameter: new_symbol");
  });

  it("allows an empty replacement symbol", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "function greet() { return greet(); }\n", "utf8");

    const tool = registerToolForTest();
    await tool.execute("call-empty", { paths: ["sample.ts"], existing_symbol: "greet", new_symbol: "" }, undefined, undefined, { cwd } as never);

    await expect(readFile(filePath, "utf8")).resolves.toBe("function () { return (); }\n");
  });

  it("does not write earlier files when a later file has a stale location", async () => {
    const cwd = await createTempDir();
    const firstPath = join(cwd, "first.ts");
    const secondPath = join(cwd, "second.ts");
    await writeFile(firstPath, "function greet() { return greet(); }\n", "utf8");
    await writeFile(secondPath, "function other() { return other(); }\n", "utf8");
    const scanner = {
      scanPaths: vi.fn(async () => [
        { absolutePath: firstPath, displayPath: "first.ts", name: "greet", startLine: 0, startColumn: 9, endLine: 0, endColumn: 14, type: "definition" },
        { absolutePath: secondPath, displayPath: "second.ts", name: "greet", startLine: 0, startColumn: 9, endLine: 0, endColumn: 14, type: "definition" },
      ]),
      invalidate: vi.fn(),
    } as unknown as SymbolScanner;

    const tool = registerToolForTest(scanner);
    await expect(tool.execute("call-stale", { paths: ["."], existing_symbol: "greet", new_symbol: "welcome" }, undefined, undefined, { cwd } as never)).rejects.toThrow("Stale symbol location for 'greet' in second.ts at line 1.");

    await expect(readFile(firstPath, "utf8")).resolves.toBe("function greet() { return greet(); }\n");
    await expect(readFile(secondPath, "utf8")).resolves.toBe("function other() { return other(); }\n");
  });

  it("does not call ctx.ui.confirm", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), "function greet() { return greet(); }\n", "utf8");
    const confirm = vi.fn();

    const tool = registerToolForTest();
    await tool.execute("call-8", { paths: ["sample.ts"], existing_symbol: "greet", new_symbol: "welcome" }, undefined, undefined, { cwd, ui: { confirm } } as never);

    expect(confirm).not.toHaveBeenCalled();
  });

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
});
