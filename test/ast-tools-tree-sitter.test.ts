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
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-ast-tools-ts-"));
  tempDirs.push(dir);
  return dir;
}

function registerSkeletonToolForTest(anchors = new AnchorStateManager()): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    }),
  };

  registerGetFileSkeletonTool(pi as unknown as ExtensionAPI, anchors);

  expect(registeredTool).toBeDefined();
  return registeredTool as RegisteredTool;
}

function registerFunctionToolForTest(anchors = new AnchorStateManager()): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    }),
  };

  registerGetFunctionTool(pi as unknown as ExtensionAPI, anchors);

  expect(registeredTool).toBeDefined();
  return registeredTool as RegisteredTool;
}

describe("tree-sitter AST read tool integration", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns class methods in file skeletons through the pi tool", async () => {
    const cwd = await createTempDir();
    const source = [
      "class Service {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "const helper = () => 2;",
    ].join("\n");
    await writeFile(join(cwd, "sample.ts"), source, "utf8");

    const tool = registerSkeletonToolForTest();
    const result = await tool.execute("call-1", { paths: ["sample.ts"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- sample.ts ---");
    expect(text).toContain("DiracA│class Service {");
    expect(text).toContain("DiracB│  run() {");
    expect(text).toContain("DiracG│const helper = () => 2;");
    expect(text).not.toContain("return 1;");
  });

  it("extracts class methods by suffix name through the pi tool", async () => {
    const cwd = await createTempDir();
    const source = [
      "class Service {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "const helper = () => 2;",
    ].join("\n");
    await writeFile(join(cwd, "sample.ts"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const result = await tool.execute(
      "call-2",
      { paths: ["sample.ts"], function_names: ["run"] },
      undefined,
      undefined,
      { cwd } as never,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("sample.ts::Service.run");
    expect(text).toContain("DiracB│  run() {");
    expect(text).toContain("DiracC│    return 1;");
    expect(text).toContain("DiracD│  }");
    expect(text).not.toContain("const helper = () => 2;");
  });
});
