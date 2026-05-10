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
  const dir = await mkdtemp(join(tmpdir(), "pi-wayfinder-find-refs-"));
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
