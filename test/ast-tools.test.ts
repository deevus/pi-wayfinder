import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  const dir = await mkdtemp(join(tmpdir(), "pi-wayfinder-ast-tools-"));
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
    expect(text).toContain("WayC│export function greet(name: string) {");
    expect(text).toContain("WayG│class Greeter {");
    expect(text).toContain("WayM│const helper = (value: number) => value + 1;");
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

  it("extracts anchored function bodies with content hashes", async () => {
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
    const body = lines.slice(2, 6);

    expect(text).toContain("sample.ts::greet");
    expect(text).toContain(`[Function Hash: ${contentHash(body.join("\n"))}]`);
    expect(text).toContain("WayC│export function greet(name: string) {");
    expect(text).toContain("WayD│  const message = `hello ${name}`;");
    expect(text).toContain("WayE│  return message;");
    expect(text).toContain("WayF│}");
    expect(text).not.toContain("WayH│class Greeter {");
    expect(text).not.toContain("sample.ts::Missing\nNot found.");
    expect(result.details).toEqual({ paths: ["sample.ts"], function_names: ["greet", "Missing"] });
  });

  it("stops JS/TS function ranges when block bodies close", async () => {
    const cwd = await createTempDir();
    const source = [
      "export function build() {",
      "  if (true) {",
      "    return { ok: true };",
      "  }",
      "}",
      "const leaked = 1;",
      "",
      "const helper = (value: number) => value + 1;",
      "const alsoLeaked = 2;"
    ].join("\n");
    await writeFile(join(cwd, "sample.ts"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const blockResult = await tool.execute(
      "call-4",
      { paths: ["sample.ts"], function_names: ["build"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const blockText = blockResult.content[0]?.type === "text" ? blockResult.content[0].text : "";

    expect(blockText).toContain("sample.ts::build");
    expect(blockText).toContain("return { ok: true };");
    expect(blockText).not.toContain("const leaked = 1;");

    const arrowResult = await tool.execute(
      "call-5",
      { paths: ["sample.ts"], function_names: ["helper"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const arrowText = arrowResult.content[0]?.type === "text" ? arrowResult.content[0].text : "";

    expect(arrowText).toContain("sample.ts::helper");
    expect(arrowText).toContain("const helper = (value: number) => value + 1;");
    expect(arrowText).not.toContain("const alsoLeaked = 2;");
  });

  it("uses JS/TS brace ranges for unexported classes", async () => {
    const cwd = await createTempDir();
    const source = [
      "class Greeter {",
      "  greet() {",
      "    return 'hello';",
      "  }",
      "}",
      "",
      "const topLevel = new Greeter();",
      "function after() {",
      "  return topLevel;",
      "}"
    ].join("\n");
    await writeFile(join(cwd, "sample.ts"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const result = await tool.execute(
      "call-10",
      { paths: ["sample.ts"], function_names: ["Greeter"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("sample.ts::Greeter");
    expect(text).toContain("class Greeter {");
    expect(text).toContain("return 'hello';");
    expect(text).not.toContain("const topLevel = new Greeter();");
    expect(text).not.toContain("function after()");
  });

  it("handles Python async def starts and boundaries", async () => {
    const cwd = await createTempDir();
    const source = [
      "def first():",
      "    return 1",
      "",
      "async def second():",
      "    return 2",
      "",
      "def third():",
      "    return 3"
    ].join("\n");
    await writeFile(join(cwd, "sample.py"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const firstResult = await tool.execute(
      "call-6",
      { paths: ["sample.py"], function_names: ["first"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const firstText = firstResult.content[0]?.type === "text" ? firstResult.content[0].text : "";

    expect(firstText).toContain("sample.py::first");
    expect(firstText).toContain("def first():");
    expect(firstText).not.toContain("async def second():");

    const secondResult = await tool.execute(
      "call-7",
      { paths: ["sample.py"], function_names: ["second"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const secondText = secondResult.content[0]?.type === "text" ? secondResult.content[0].text : "";

    expect(secondText).toContain("sample.py::second");
    expect(secondText).toContain("async def second():");
    expect(secondText).not.toContain("def third():");
  });

  it("stops Python ranges before top-level assignment or call after function/class", async () => {
    const cwd = await createTempDir();
    const source = [
      "def compute():  # inline header comment",
      "    return 1",
      "x = 2",
      "print(compute())",
      "",
      "class Widget:  # inline class comment",
      "    def run(self):",
      "        return 3",
      "log(Widget)",
      "def after():",
      "    return 4"
    ].join("\n");
    await writeFile(join(cwd, "sample.py"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const functionResult = await tool.execute(
      "call-11",
      { paths: ["sample.py"], function_names: ["compute"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const functionText = functionResult.content[0]?.type === "text" ? functionResult.content[0].text : "";

    expect(functionText).toContain("sample.py::compute");
    expect(functionText).toContain("def compute():  # inline header comment");
    expect(functionText).toContain("    return 1");
    expect(functionText).not.toContain("x = 2");
    expect(functionText).not.toContain("print(compute())");

    const classResult = await tool.execute(
      "call-12",
      { paths: ["sample.py"], function_names: ["Widget"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const classText = classResult.content[0]?.type === "text" ? classResult.content[0].text : "";

    expect(classText).toContain("sample.py::Widget");
    expect(classText).toContain("class Widget:  # inline class comment");
    expect(classText).toContain("        return 3");
    expect(classText).not.toContain("log(Widget)");
    expect(classText).not.toContain("def after():");
  });

  it("uses Python indentation ranges for multi-line async def signatures", async () => {
    const cwd = await createTempDir();
    const source = [
      "async def multi_line(",
      "    first,",
      "    second,",
      "):",
      "    return first + second",
      "",
      "def after():",
      "    return 3"
    ].join("\n");
    await writeFile(join(cwd, "sample.py"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const result = await tool.execute(
      "call-8",
      { paths: ["sample.py"], function_names: ["multi_line"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("sample.py::multi_line");
    expect(text).toContain("async def multi_line(");
    expect(text).toContain("    second,");
    expect(text).toContain("):");
    expect(text).toContain("    return first + second");
    expect(text).not.toContain("def after():");
  });

  it("ignores braces inside JS strings and comments when extracting ranges", async () => {
    const cwd = await createTempDir();
    const source = [
      "export function safeBraces() {",
      "  const single = '}';",
      "  const double = \"}\";",
      "  const template = `}`;",
      "  // } in a line comment",
      "  /* { in a block comment",
      "     } still in a block comment */",
      "  return { ok: true };",
      "}",
      "const leaked = 1;"
    ].join("\n");
    await writeFile(join(cwd, "sample.ts"), source, "utf8");

    const tool = registerFunctionToolForTest();
    const result = await tool.execute(
      "call-9",
      { paths: ["sample.ts"], function_names: ["safeBraces"] },
      undefined,
      undefined,
      { cwd } as never
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("sample.ts::safeBraces");
    expect(text).toContain("const single = '}';");
    expect(text).toContain('const double = "}";');
    expect(text).toContain("const template = `}`;");
    expect(text).toContain("return { ok: true };");
    expect(text).toContain("WayI│}");
    expect(text).not.toContain("const leaked = 1;");
  });
});
