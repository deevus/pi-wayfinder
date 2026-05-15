import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../anchors/line-hashing.js";
import { renderCodeLikeCall, renderCodeLikeResult } from "../rendering/pi-renderers.js";
import type { SymbolLocation, SymbolLocationType, SymbolScanner } from "../symbols/symbol-scanner.js";
import { FindSymbolReferencesSchema } from "./schemas.js";

type FindType = SymbolLocationType | "both";

function validateFindType(value: unknown): FindType {
  if (value === undefined) return "both";
  if (value === "definition" || value === "reference" || value === "both") return value;
  throw new Error(`Invalid find_type: ${String(value)}`);
}

function missingMessage(findType: FindType, symbols: string[]): string {
  const label = findType === "both" ? "references or definitions" : `${findType}s`;
  return `No ${label} found for symbols: ${symbols.join(", ")}.`;
}

function filterLocations(locations: SymbolLocation[], symbols: string[], findType: FindType): SymbolLocation[] {
  const symbolSet = new Set(symbols);
  return locations.filter((location) => {
    if (!symbolSet.has(location.name)) return false;
    return findType === "both" || location.type === findType;
  });
}

async function formatLocations(locations: SymbolLocation[], anchors: AnchorStateManager): Promise<string> {
  const byFile = new Map<string, SymbolLocation[]>();
  for (const location of locations) {
    const fileLocations = byFile.get(location.absolutePath) || [];
    fileLocations.push(location);
    byFile.set(location.absolutePath, fileLocations);
  }

  const output: string[] = [];
  const sortedFiles = Array.from(byFile.entries()).sort((a, b) => {
    const aDisplay = a[1][0]?.displayPath || a[0];
    const bDisplay = b[1][0]?.displayPath || b[0];
    return aDisplay.localeCompare(bDisplay);
  });

  for (const [absolutePath, fileLocations] of sortedFiles) {
    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const lineAnchors = anchors.reconcile(absolutePath, lines);
    const merged = new Map<number, Set<string>>();

    for (const location of fileLocations.sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn)) {
      const lineSymbols = merged.get(location.startLine) || new Set<string>();
      lineSymbols.add(location.name);
      merged.set(location.startLine, lineSymbols);
    }

    const displayPath = fileLocations[0]?.displayPath || absolutePath;
    output.push(`${displayPath}:`);
    for (const [lineIndex, symbols] of Array.from(merged.entries()).sort((a, b) => a[0] - b[0])) {
      output.push(`  (${Array.from(symbols).join(", ")}) ${formatLineWithHash(lines[lineIndex], lineAnchors[lineIndex]).trim()}`);
    }
    output.push("");
  }

  return output.join("\n").trim();
}

export function registerFindSymbolReferencesTool(pi: ExtensionAPI, anchors: AnchorStateManager, scanner: SymbolScanner): void {
  pi.registerTool({
    name: "find_symbol_references",
    label: "Find Symbol References",
    description: "Find exact tree-sitter definitions and references for one or more symbols across files or directories.",
    promptSnippet: "Find exact AST definitions/references of symbols across paths with anchored lines.",
    promptGuidelines: [
      "Use find_symbol_references before rename_symbol when you need to inspect where a symbol appears.",
      "Use find_symbol_references with narrow paths when possible to avoid broad symbol scans."
    ],
    parameters: FindSymbolReferencesSchema,
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      const symbols = Array.isArray(args.symbols) ? args.symbols.join(", ") : "";
      const suffix = symbols ? theme.fg("dim", ` (${symbols})`) : "";
      return renderCodeLikeCall("find_symbol_references", paths, theme, suffix);
    },
    renderResult(result, options, theme, context) {
      return renderCodeLikeResult(result, options, theme, context);
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const paths = params.paths as string[] | undefined;
      const symbols = params.symbols as string[] | undefined;
      if (!Array.isArray(paths) || paths.length === 0) throw new Error("Missing required parameter: paths");
      if (!Array.isArray(symbols) || symbols.length === 0) throw new Error("Missing required parameter: symbols");
      const findType = validateFindType(params.find_type);

      const locations = await scanner.scanPaths(paths, ctx.cwd, signal);
      const hits = filterLocations(locations, symbols, findType);
      const text = hits.length > 0 ? await formatLocations(hits, anchors) : missingMessage(findType, symbols);

      return {
        content: [{ type: "text", text }],
        details: { paths, symbols, find_type: findType, matches: hits.length }
      };
    }
  });
}
