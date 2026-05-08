import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRequiredLanguageParsers } from "../src/ast/language-parser.js";
import { parseFile } from "../src/ast/parse-file.js";

const tempDirs: string[] = [];
async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-parse-file-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseFile", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("extracts TypeScript functions, methods, classes, and arrow functions", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "export function topLevel() { return 1; }",
      "class Service {",
      "  method() { return topLevel(); }",
      "  field = () => 2;",
      "}",
      "const helper = () => 3;"
    ].join("\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers);

    expect(defs?.map((def) => def.text)).toEqual([
      "export function topLevel() { return 1; }",
      "class Service {",
      "  method() { return topLevel(); }",
      "  field = () => 2;",
      "const helper = () => 3;"
    ]);
  });

  it("adds line counts and call graph when requested", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "function called() { return 1; }",
      "function caller() {",
      "  return called();",
      "}"
    ].join("\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers, { showCallGraph: true });
    const caller = defs?.find((def) => def.text === "function caller() {");

    expect(caller?.lineCount).toBe(3);
    expect(caller?.calls).toEqual(["called"]);
  });

  it("normalizes CRLF line endings in returned definition text", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "function first() { return 1; }",
      "function second() { return first(); }"
    ].join("\r\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers);

    expect(defs?.map((def) => def.text)).toEqual([
      "function first() { return 1; }",
      "function second() { return first(); }"
    ]);
  });

  it("does not count nested function calls as calls of the outer function", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "function called() { return 1; }",
      "function outer() {",
      "  function inner() {",
      "    return called();",
      "  }",
      "  return 0;",
      "}"
    ].join("\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers, { showCallGraph: true });
    const outer = defs?.find((def) => def.text === "function outer() {");
    const inner = defs?.find((def) => def.text === "  function inner() {");

    expect(outer?.calls).toBeUndefined();
    expect(inner?.calls).toEqual(["called"]);
  });

  it("does not count member calls as local function calls by bare property name", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, [
      "function save() { return 1; }",
      "function caller(api: { save: () => number }) {",
      "  return api.save();",
      "}"
    ].join("\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers, { showCallGraph: true });
    const caller = defs?.find((def) => def.text === "function caller(api: { save: () => number }) {");

    expect(caller?.calls).toBeUndefined();
  });

  it("does not count Java member method invocations as bare local calls", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "Sample.java");
    await writeFile(filePath, [
      "class Sample {",
      "  void save() {}",
      "  void memberOnly(Api api) {",
      "    api.save();",
      "  }",
      "  void bareCaller() {",
      "    save();",
      "  }",
      "}"
    ].join("\n"), "utf8");

    const parsers = await loadRequiredLanguageParsers([filePath]);
    const defs = await parseFile(filePath, parsers, { showCallGraph: true });
    const memberOnly = defs?.find((def) => def.text === "  void memberOnly(Api api) {");
    const bareCaller = defs?.find((def) => def.text === "  void bareCaller() {");

    expect(memberOnly?.calls).toBeUndefined();
    expect(bareCaller?.calls).toEqual(["save"]);
  });
});
