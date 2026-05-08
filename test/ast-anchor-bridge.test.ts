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
