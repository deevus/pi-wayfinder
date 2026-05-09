import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import type { SymbolLocation, SymbolScanner } from "../symbols/symbol-scanner.js";
import { RenameSymbolSchema } from "./schemas.js";

export interface RenameLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  displayPath: string;
}

interface PreparedRenameFile {
  absolutePath: string;
  displayPath: string;
  finalContent: string;
  finalLines: string[];
  replacementCount: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("rename_symbol aborted");
}

function splitPreservingEol(content: string): { lines: string[]; eol: "\r\n" | "\n" } {
  return {
    lines: content.split(/\r?\n/),
    eol: content.match(/\r\n|\n/)?.[0] === "\r\n" ? "\r\n" : "\n"
  };
}

export function applySymbolRenameToContent(
  content: string,
  locations: RenameLocation[],
  existingSymbol: string,
  newSymbol: string
): { finalContent: string; replacementCount: number } {
  const { lines, eol } = splitPreservingEol(content);
  const sorted = [...locations].sort((a, b) => {
    if (b.startLine !== a.startLine) return b.startLine - a.startLine;
    return b.startColumn - a.startColumn;
  });

  let replacementCount = 0;
  for (const location of sorted) {
    const line = lines[location.startLine];
    const actual = line?.slice(location.startColumn, location.endColumn);
    if (actual !== existingSymbol) {
      throw new Error(`Stale symbol location for '${existingSymbol}' in ${location.displayPath} at line ${location.startLine + 1}.`);
    }
    lines[location.startLine] = line.slice(0, location.startColumn) + newSymbol + line.slice(location.endColumn);
    replacementCount++;
  }

  return { finalContent: lines.join(eol), replacementCount };
}

async function withFileMutationQueues<T>(absolutePaths: string[], fn: () => Promise<T>): Promise<T> {
  const uniquePaths = Array.from(new Set(absolutePaths)).sort();
  const runWithQueue = async (index: number): Promise<T> => {
    if (index >= uniquePaths.length) return fn();
    return withFileMutationQueue(uniquePaths[index], () => runWithQueue(index + 1));
  };
  return runWithQueue(0);
}

function groupLocationsByFile(locations: SymbolLocation[]): Map<string, SymbolLocation[]> {
  const byFile = new Map<string, SymbolLocation[]>();
  for (const location of locations) {
    const fileLocations = byFile.get(location.absolutePath) || [];
    fileLocations.push(location);
    byFile.set(location.absolutePath, fileLocations);
  }
  return byFile;
}

export function registerRenameSymbolTool(pi: ExtensionAPI, anchors: AnchorStateManager, scanner: SymbolScanner): void {
  pi.registerTool({
    name: "rename_symbol",
    label: "Rename Symbol",
    description: "Rename all exact tree-sitter definitions and references of a symbol inside specified files or directories.",
    promptSnippet: "Rename exact AST symbol definitions and references across paths.",
    promptGuidelines: [
      "Use rename_symbol for broad symbol renames after confirming the target symbol and paths.",
      "Use find_symbol_references first when a rename could affect many files or an ambiguous symbol name."
    ],
    parameters: RenameSymbolSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const paths = params.paths as string[] | undefined;
      const existingSymbol = params.existing_symbol as unknown;
      const newSymbol = params.new_symbol as unknown;
      if (!Array.isArray(paths) || paths.length === 0) throw new Error("Missing required parameter: paths");
      if (typeof existingSymbol !== "string" || existingSymbol.length === 0) throw new Error("Missing required parameter: existing_symbol");
      if (typeof newSymbol !== "string") throw new Error("Missing required parameter: new_symbol");

      const locations = (await scanner.scanPaths(paths, ctx.cwd, signal)).filter((location) => location.name === existingSymbol);
      if (locations.length === 0) {
        return {
          content: [{ type: "text", text: `No occurrences of symbol '${existingSymbol}' found in the specified paths.` }],
          details: { paths, existing_symbol: existingSymbol, new_symbol: newSymbol, replacements: 0 }
        };
      }

      const byFile = groupLocationsByFile(locations);
      const preparedFiles = await withFileMutationQueues(Array.from(byFile.keys()), async () => {
        const prepared: PreparedRenameFile[] = [];

        for (const [absolutePath, fileLocations] of Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
          throwIfAborted(signal);
          const originalContent = await readFile(absolutePath, { encoding: "utf8", signal });
          const renameLocations = fileLocations.map((location) => ({
            startLine: location.startLine,
            startColumn: location.startColumn,
            endLine: location.endLine,
            endColumn: location.endColumn,
            displayPath: location.displayPath
          }));
          const { finalContent, replacementCount } = applySymbolRenameToContent(originalContent, renameLocations, existingSymbol, newSymbol);
          prepared.push({
            absolutePath,
            displayPath: fileLocations[0]?.displayPath || absolutePath,
            finalContent,
            finalLines: finalContent.split(/\r?\n/),
            replacementCount
          });
        }

        for (const file of prepared) {
          throwIfAborted(signal);
          await writeFile(file.absolutePath, file.finalContent, { encoding: "utf8", signal });
          anchors.reconcile(file.absolutePath, file.finalLines);
          scanner.invalidate(file.absolutePath);
        }

        return prepared;
      });

      const totalReplacements = preparedFiles.reduce((sum, file) => sum + file.replacementCount, 0);
      const fileLabel = preparedFiles.length === 1 ? "file" : "files";
      return {
        content: [{ type: "text", text: `Successfully renamed symbol '${existingSymbol}' to '${newSymbol}' (${totalReplacements} occurrences in ${preparedFiles.length} ${fileLabel}).` }],
        details: {
          paths,
          existing_symbol: existingSymbol,
          new_symbol: newSymbol,
          replacements: totalReplacements,
          files: preparedFiles.map((file) => file.displayPath)
        }
      };
    }
  });
}
