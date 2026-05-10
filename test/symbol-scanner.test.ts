import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SymbolCache } from "../src/symbols/symbol-cache.js";
import { SymbolScanner, discoverSourceFiles, isExcludedPathSegment, isSupportedSymbolPath } from "../src/symbols/symbol-scanner.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-wayfinder-symbol-scanner-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("symbol scanner helpers", () => {
  it("recognizes supported source files and excluded path segments", () => {
    expect(isSupportedSymbolPath("sample.ts")).toBe(true);
    expect(isSupportedSymbolPath("sample.tsx")).toBe(true);
    expect(isSupportedSymbolPath("sample.py")).toBe(true);
    expect(isSupportedSymbolPath("sample.zig")).toBe(true);
    expect(isSupportedSymbolPath("sample.lua")).toBe(true);
    expect(isSupportedSymbolPath("sample.ex")).toBe(true);
    expect(isSupportedSymbolPath("README.md")).toBe(false);
    expect(isExcludedPathSegment("node_modules")).toBe(true);
    expect(isExcludedPathSegment("dist")).toBe(true);
    expect(isExcludedPathSegment("src")).toBe(false);
  });

  it("discovers supported files recursively while skipping excluded directories", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "main.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(cwd, "notes.md"), "# notes\n", "utf8");
    await mkdir(join(cwd, "node_modules"), { recursive: true });
    await writeFile(join(cwd, "node_modules", "ignored.ts"), "export const ignored = 1;\n", "utf8");

    const files = await discoverSourceFiles(["."], cwd);

    expect(files.map((file) => file.displayPath)).toEqual(["main.ts"]);
  });
});

describe("SymbolScanner", () => {
  it("scans TypeScript definitions and references", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.ts"), [
      "export function greet(name: string) {",
      "  return name.toUpperCase();",
      "}",
      "const result = greet('Ada');",
      "",
    ].join("\n"), "utf8");

    const scanner = new SymbolScanner(new SymbolCache());
    const locations = await scanner.scanPaths(["sample.ts"], cwd);

    expect(locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayPath: "sample.ts", name: "greet", type: "definition", kind: "function", startLine: 0 }),
      expect.objectContaining({ displayPath: "sample.ts", name: "greet", type: "reference", startLine: 3 }),
    ]));
    expect(locations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ displayPath: "sample.ts", name: "greet", type: "reference", startLine: 0 }),
    ]));
  });

  it("scans JavaScript and Python files", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.js"), "function run() { return run(); }\n", "utf8");
    await writeFile(join(cwd, "sample.py"), "def greet():\n    return greet()\n", "utf8");

    const scanner = new SymbolScanner(new SymbolCache());
    const locations = await scanner.scanPaths(["."], cwd);

    expect(locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayPath: "sample.js", name: "run", type: "definition" }),
      expect.objectContaining({ displayPath: "sample.py", name: "greet", type: "definition" }),
    ]));
  });

  it("reuses cached scan results while file metadata is unchanged and invalidates when metadata changes", async () => {
    const cwd = await createTempDir();
    const filePath = join(cwd, "sample.ts");
    await writeFile(filePath, "export function first() { return first(); }\n", "utf8");

    const cache = new SymbolCache();
    const scanner = new SymbolScanner(cache);

    const first = await scanner.scanPaths(["sample.ts"], cwd);
    const second = await scanner.scanPaths(["sample.ts"], cwd);
    expect(second).toEqual(first);
    expect(cache.size()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(filePath, "export function second() { return second(); }\n", "utf8");

    const third = await scanner.scanPaths(["sample.ts"], cwd);
    expect(third).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "second", type: "definition" }),
    ]));
    expect(third).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "first", type: "definition" }),
    ]));
  });

  it("scans representative fixtures across supported tree-sitter extensions", async () => {
    const cwd = await createTempDir();
    const fixtures: Record<string, string> = {
      "sample.ts": "export function tsName() { return tsName(); }\n",
      "sample.tsx": "export function TsxName() { return <div />; }\n",
      "sample.js": "function jsName() { return jsName(); }\n",
      "sample.jsx": "function JsxName() { return <div />; }\n",
      "sample.py": "def py_name():\n    return py_name()\n",
      "sample.go": "package main\nfunc goName() { goName() }\n",
      "sample.rs": "fn rust_name() { rust_name(); }\n",
      "sample.c": "void c_name() { c_name(); }\n",
      "sample.cpp": "void cppName() { cppName(); }\n",
      "sample.cs": "class CSharpSample { void CsName() { CsName(); } }\n",
      "sample.rb": "def ruby_name\n  ruby_name\nend\n",
      "Sample.java": "class Sample { void javaName() { javaName(); } }\n",
      "sample.php": "<?php function php_name() { php_name(); }\n",
      "sample.swift": "func swiftName() { swiftName() }\n",
      "sample.kt": "fun kotlinName() { kotlinName() }\n",
      "sample.sh": "function shellName() { shellName; }\n",
      "sample.zig": "fn zigName() void { zigName(); }\n",
      "sample.lua": "local function luaName() luaName() end\n",
      "sample.ex": "defmodule Sample do\n  def elixir_name(), do: elixir_name()\nend\n",
      "sample.el": "(defun elisp-name () (elisp-name))\n",
      "sample.ml": "let ocaml_name () = ocaml_name ()\n",
      "sample.res": "let rescriptName = () => rescriptName()\n",
      "sample.scala": "object Sample { def scalaName() = scalaName() }\n",
      "sample.sol": "contract Sample { function solidityName() public { } }\n",
      "sample.rdl": "addrmap rdlName { reg { field {} f; } r; };\n",
      "sample.tla": "---- MODULE Sample ----\nVARIABLE x\ntlaName == x\n====\n",
      "sample.css": ".cssName { color: red; }\n",
    };

    for (const [fileName, content] of Object.entries(fixtures)) {
      await writeFile(join(cwd, fileName), content, "utf8");
    }

    const scanner = new SymbolScanner(new SymbolCache());
    const locations = await scanner.scanPaths(["."], cwd);
    const definitions = locations.filter((location) => location.type === "definition").map((location) => location.displayPath);

    for (const fileName of Object.keys(fixtures)) {
      expect(definitions, `expected at least one definition in ${fileName}`).toContain(fileName);
    }
  });
});
