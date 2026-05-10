import { readFile, readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type Parser from "web-tree-sitter";
import { loadRequiredLanguageParsers } from "../ast/language-parser.js";
import type { SymbolCache } from "./symbol-cache.js";

export type SymbolLocationType = "definition" | "reference";

export interface SymbolLocation {
  absolutePath: string;
  displayPath: string;
  name: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  type: SymbolLocationType;
  kind?: string;
}

export interface SourceFile {
  absolutePath: string;
  displayPath: string;
}

export const SUPPORTED_SYMBOL_EXTENSIONS = new Set([
  "bash",
  "sh",
  "zsh",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rs",
  "go",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "hh",
  "hxx",
  "cs",
  "css",
  "el",
  "elisp",
  "ex",
  "exs",
  "rb",
  "java",
  "php",
  "swift",
  "kt",
  "kts",
  "lua",
  "m",
  "mm",
  "ml",
  "mli",
  "res",
  "resi",
  "scala",
  "sc",
  "sol",
  "rdl",
  "tla",
  "zig",
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".github",
  ".vscode",
  ".cursor",
  ".wayfinder",
  "out",
  "dist",
  "dist-standalone",
  "build",
  "target",
  "bin",
  "obj",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".env",
  ".cache",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  "tmp",
  "temp",
  "vendor",
  "generated",
  "__generated__",
  "artifacts",
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "mix.lock",
]);

const MAX_FILE_SIZE = 1024 * 1024;

export function isExcludedPathSegment(segment: string): boolean {
  if (EXCLUDED_PATH_SEGMENTS.has(segment)) return true;
  if (segment.startsWith(".") && !segment.startsWith(".wayfinder")) return true;
  return false;
}

export function isSupportedSymbolPath(filePath: string): boolean {
  if (EXCLUDED_FILES.has(filePath.split(/[\\/]/).pop() || "")) return false;
  const ext = extname(filePath).toLowerCase().slice(1);
  return SUPPORTED_SYMBOL_EXTENSIONS.has(ext);
}

export function resolveRequestedPath(requestedPath: string, cwd: string): { absolutePath: string; displayPath: string } {
  const cleaned = requestedPath.replace(/^@/, "");
  const absolutePath = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
  const displayPath = isAbsolute(cleaned) ? relative(cwd, absolutePath) || absolutePath : cleaned;
  return { absolutePath, displayPath: displayPath || "." };
}

export async function discoverSourceFiles(requestedPaths: string[], cwd: string): Promise<SourceFile[]> {
  const files = new Map<string, SourceFile>();

  async function visit(absolutePath: string): Promise<void> {
    let stats;
    try {
      stats = await stat(absolutePath);
    } catch {
      return;
    }

    const name = absolutePath.split(sep).pop() || "";
    if (isExcludedPathSegment(name)) return;

    if (stats.isDirectory()) {
      const entries = await readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (isExcludedPathSegment(entry.name)) continue;
        await visit(join(absolutePath, entry.name));
      }
      return;
    }

    if (!stats.isFile()) return;
    if (stats.size > MAX_FILE_SIZE) return;
    if (!isSupportedSymbolPath(absolutePath)) return;

    const displayPath = relative(cwd, absolutePath) || absolutePath;
    files.set(absolutePath, { absolutePath, displayPath });
  }

  for (const requestedPath of requestedPaths) {
    const resolved = resolveRequestedPath(requestedPath, cwd);
    await visit(resolved.absolutePath);
  }

  return Array.from(files.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

function spanKey(capture: Parser.QueryCapture): string {
  return `${capture.node.startIndex}:${capture.node.endIndex}`;
}

function definitionKind(captureName: string): string | undefined {
  if (!captureName.includes("name.definition")) return undefined;
  return captureName.split(".").pop();
}

function captureToLocation(
  absolutePath: string,
  displayPath: string,
  capture: Parser.QueryCapture,
  fileContent: string,
  definitionSpans: Set<string>,
): SymbolLocation | null {
  const isDefinition = capture.name.includes("name.definition");
  if (capture.name !== "name.reference" && !isDefinition) return null;
  if (!isDefinition && definitionSpans.has(spanKey(capture))) return null;

  const name = fileContent.slice(capture.node.startIndex, capture.node.endIndex);
  if (!name) return null;

  return {
    absolutePath,
    displayPath,
    name,
    startLine: capture.node.startPosition.row,
    startColumn: capture.node.startPosition.column,
    endLine: capture.node.endPosition.row,
    endColumn: capture.node.endPosition.column,
    type: isDefinition ? "definition" : "reference",
    kind: definitionKind(capture.name),
  };
}

export class SymbolScanner {
  constructor(private readonly cache: SymbolCache) {}

  invalidate(absolutePath: string): void {
    this.cache.delete(absolutePath);
  }

  async scanPaths(requestedPaths: string[], cwd: string, signal?: AbortSignal): Promise<SymbolLocation[]> {
    const files = await discoverSourceFiles(requestedPaths, cwd);
    if (files.length === 0) return [];

    const parsers = await loadRequiredLanguageParsers(files.map((file) => file.absolutePath));
    const allLocations: SymbolLocation[] = [];

    for (const file of files) {
      if (signal?.aborted) throw signal.reason ?? new Error("symbol scan aborted");
      const stats = await stat(file.absolutePath);
      const cached = this.cache.get(file.absolutePath, { mtimeMs: stats.mtimeMs, size: stats.size });
      if (cached) {
        allLocations.push(...cached.locations);
        continue;
      }

      const ext = extname(file.absolutePath).toLowerCase().slice(1);
      const parserInfo = parsers[ext];
      if (!parserInfo) continue;

      const fileContent = await readFile(file.absolutePath, { encoding: "utf8", signal });
      let tree: Parser.Tree | null = null;
      try {
        tree = parserInfo.parser.parse(fileContent);
        if (!tree?.rootNode) continue;
        const captures = parserInfo.query.captures(tree.rootNode);
        const definitionSpans = new Set(captures.filter((capture) => capture.name.includes("name.definition")).map(spanKey));
        const locations = captures
          .map((capture) => captureToLocation(file.absolutePath, file.displayPath, capture, fileContent, definitionSpans))
          .filter((location): location is SymbolLocation => location !== null);
        this.cache.set({
          absolutePath: file.absolutePath,
          displayPath: file.displayPath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          locations,
        });
        allLocations.push(...locations);
      } finally {
        tree?.delete();
      }
    }

    return allLocations.sort((a, b) => a.displayPath.localeCompare(b.displayPath) || a.startLine - b.startLine || a.startColumn - b.startColumn);
  }
}
