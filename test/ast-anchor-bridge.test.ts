import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { contentHash } from "../src/anchors/line-hashing.js";
import { ASTAnchorBridge } from "../src/ast/ast-anchor-bridge.js";

const tempDirs: string[] = [];
async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-wayfinder-bridge-"));
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
    expect(text).toContain("WayA│export class Service {");
    expect(text).toContain("WayB│  run() { return 1; }");
    expect(text).toContain("WayD│export const helper = () => 2;");
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
    expect(result?.formattedContent).toContain("WayD│  run() {");
    expect(result?.formattedContent).toContain("WayE│    return dep(this.value);");
    expect(result?.formattedContent).toContain("WayF│  }");
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

    expect(result?.formattedContent).toContain("WayA│/** Docs for helper */");
    expect(result?.formattedContent).toContain("WayB│export function helper() {");
  });

  it("does not include non-adjacent previous comments in function ranges or hashes", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    const functionText = [
      "export function helper() {",
      "  return 1;",
      "}"
    ].join("\n");
    await writeFile(filePath, [
      "// Detached docs",
      "",
      functionText
    ].join("\n"), "utf8");

    const result = await ASTAnchorBridge.getFunctions(filePath, "sample.ts", ["helper"], new AnchorStateManager());

    expect(result?.formattedContent).not.toContain("WayA│// Detached docs");
    expect(result?.formattedContent).toContain("WayC│export function helper() {");
    expect(result?.formattedContent).toContain(`[Function Hash: ${contentHash(functionText)}]`);
  });

  it("adds class property context only for this/self member usage and avoids unrelated imports", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "import { dep } from './dep';",
      "import { unused } from './used';",
      "",
      "class Service {",
      "  used = 1;",
      "  value = 2;",
      "  run(value: number) {",
      "    const local = value;",
      "    return dep(this.used + local);",
      "  }",
      "}"
    ].join("\n"), "utf8");

    const result = await ASTAnchorBridge.getFunctions(filePath, "sample.ts", ["run"], new AnchorStateManager());

    expect(result?.formattedContent).toContain("WayA│import { dep } from './dep';");
    expect(result?.formattedContent).not.toContain("WayB│import { unused } from './used';");
    expect(result?.formattedContent).toContain("WayE│  used = 1;");
    expect(result?.formattedContent).not.toContain("WayF│  value = 2;");
  });

  it("does not duplicate target class fields while collecting context", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "class Service {",
      "  run = () => this.used;",
      "  used = 1;",
      "}"
    ].join("\n"), "utf8");

    const result = await ASTAnchorBridge.getFunctions(filePath, "sample.ts", ["run"], new AnchorStateManager());
    const marker = "│  run = () => this.used";

    expect(result?.formattedContent.split(marker).length).toBe(2);
    expect(result?.formattedContent).toContain("WayC│  used = 1;");
  });

  it("returns symbol ranges with adjacent comments, nameText, and no detached comments", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    const source = [
      "class Service {",
      "  // method docs",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "// detached docs",
      "",
      "export function helper() {",
      "  return 2;",
      "}"
    ].join("\n");
    await writeFile(filePath, source, "utf8");

    const anchors = new AnchorStateManager();
    const methodRange = await ASTAnchorBridge.getSymbolRange(filePath, "run", anchors, "method");
    const functionRange = await ASTAnchorBridge.getSymbolRange(filePath, "helper", anchors, "function");

    expect(methodRange?.nameText).toBe("run");
    expect(methodRange && source.slice(methodRange.startIndex, methodRange.endIndex)).toContain("  // method docs");
    expect(functionRange?.nameText).toBe("helper");
    expect(functionRange && source.slice(functionRange.startIndex, functionRange.endIndex)).not.toContain("// detached docs");
    expect(functionRange && source.slice(functionRange.startIndex, functionRange.endIndex)).toContain("export function helper() {");
  });
});
