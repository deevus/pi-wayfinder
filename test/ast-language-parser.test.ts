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
