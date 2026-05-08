import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { contentHash } from "../src/anchors/line-hashing.js";
import { registerGetFileSkeletonTool } from "../src/tools/get-file-skeleton.js";
import { registerGetFunctionTool } from "../src/tools/get-function.js";

 type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-ast-tools-"));
  tempDirs.push(dir);
  return dir;
}

function registerSkeletonToolForTest(anchors = new AnchorStateManager()): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    })
  };

  registerGetFileSkeletonTool(pi as unknown as ExtensionAPI, anchors);

  expect(registeredTool).toBeDefined();
  expect(registeredTool?.name).toBe("get_file_skeleton");
  expect(registeredTool?.label).toBe("Get File Skeleton");
  expect(registeredTool?.description).toContain("compact anchored outline");
  return registeredTool as RegisteredTool;
}

function registerFunctionToolForTest(anchors = new AnchorStateManager()): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    })
  };

  registerGetFunctionTool(pi as unknown as ExtensionAPI, anchors);

  expect(registeredTool).toBeDefined();
  expect(registeredTool?.name).toBe("get_function");
  expect(registeredTool?.label).toBe("Get Function");
  expect(registeredTool?.description).toContain("Extract anchored implementations");
  return registeredTool as RegisteredTool;
}

describe("AST read tools", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns anchored function and class definition lines in file skeletons", async () => {
    const cwd = await createTempDir();
    const source = [
      "import { value } from './value.js';",
      "",
      "export function greet(name: string) {",
      "  return `hello ${name}`;",
      "}",
      "",
      "class Greeter {",
      "  greet() {",
      "    return greet('world');",
      "  }",
      "}",
      "",
      "const helper = (value: number) => value + 1;"
    ].join("\n");
    await writeFile(join(cwd, "sample.ts"), source, "utf8");

    const tool = registerSkeletonToolForTest();
    const result = await tool.execute("call-1", { paths: ["sample.ts"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- sample.ts ---");
    expect(text).toContain("DiracC│export function greet(name: string) {");
    expect(text).toContain("DiracG│class Greeter {");
    expect(text).toContain("DiracM│const helper = (value: number) => value + 1;");
    expect(text).not.toContain("return `hello ${name}`;");
    expect(result.details).toEqual({ paths: ["sample.ts"] });
  });

  it("reports when no skeleton definitions are found", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "notes.txt"), "plain\ntext", "utf8");

    const tool = registerSkeletonToolForTest();
    const result = await tool.execute("call-2", { paths: ["notes.txt"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toBe("--- notes.txt ---\nNo definitions found.");
  });

  it("extracts anchored function bodies with content hashes and reports missing names", async () => {
    const cwd = await createTempDir();
    const source = [
      "const before = 1;",
      "",
      "export function greet(name: string) {",
      "  const message = `hello ${name}`;",
      "  return message;",
      "}",
      "",
      "class Greeter {",
      "  run() {",
      "    return greet('world');",
      "  }",
      "}"
    ].join("\n");
    await writeFile(join(cwd, "sample.ts"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const result = await tool.execute(
      "call-3",
      { paths: ["sample.ts"], function_names: ["greet", "Missing"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const lines = source.split(/\r?\n/);
    const body = lines.slice(2, 7);

    expect(text).toContain("sample.ts::greet");
    expect(text).toContain(`[Function Hash: ${contentHash(body.join("\n"))}]`);
    expect(text).toContain("DiracC│export function greet(name: string) {");
    expect(text).toContain("DiracD│  const message = `hello ${name}`;");
    expect(text).toContain("DiracE│  return message;");
    expect(text).toContain("DiracF│}");
    expect(text).not.toContain("DiracH│class Greeter {");
    expect(text).toContain("sample.ts::Missing\nNot found.");
    expect(result.details).toEqual({ paths: ["sample.ts"], function_names: ["greet", "Missing"] });
  });
});
