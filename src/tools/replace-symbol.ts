import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { stripHashes } from "../anchors/line-hashing.js";
import type { SymbolRange } from "../ast/ast-anchor-bridge.js";
import { ReplaceSymbolSchema } from "./schemas.js";

export interface SymbolReplacement {
  path: string;
  symbol: string;
  text: string;
  type?: string;
}

export interface FileReplacementBatch {
  absolutePath: string;
  displayPath: string;
  replacements: SymbolReplacement[];
}

export interface ResolvedSymbolReplacement {
  replacement: SymbolReplacement;
  range: SymbolRange;
}

export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.match(/\r\n|\n/)?.[0] === "\r\n" ? "\r\n" : "\n";
}

export function normalizeReplacementText(text: string, lineEnding: "\r\n" | "\n"): string {
  return stripHashes(text).replace(/\r\n|\r|\n/g, lineEnding);
}

export function groupReplacementsByPath(replacements: SymbolReplacement[], cwd: string): FileReplacementBatch[] {
  const batches = new Map<string, FileReplacementBatch>();

  for (const replacement of replacements) {
    const cleanedPath = replacement.path.replace(/^@/, "");
    const absolutePath = resolve(cwd, cleanedPath);
    const existing = batches.get(absolutePath);
    if (existing) {
      existing.replacements.push(replacement);
    } else {
      batches.set(absolutePath, {
        absolutePath,
        displayPath: replacement.path,
        replacements: [replacement],
      });
    }
  }

  return Array.from(batches.values());
}

export function applyResolvedSymbolReplacements(
  content: string,
  resolvedReplacements: ResolvedSymbolReplacement[],
  lineEnding: "\r\n" | "\n",
): string {
  const sorted = [...resolvedReplacements].sort((a, b) => a.range.startIndex - b.range.startIndex);
  for (let index = 0; index < sorted.length - 1; index++) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (current.range.endIndex > next.range.startIndex) {
      throw new Error(
        `Overlapping replacements detected for symbols '${current.replacement.symbol}' and '${next.replacement.symbol}' in ${current.replacement.path}.`,
      );
    }
  }

  let nextContent = content;
  for (const item of sorted.sort((a, b) => b.range.startIndex - a.range.startIndex)) {
    const replacementText = normalizeReplacementText(item.replacement.text, lineEnding);
    nextContent = nextContent.slice(0, item.range.startIndex) + replacementText + nextContent.slice(item.range.endIndex);
  }

  return nextContent;
}

export function registerReplaceSymbolTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  void anchors;
  pi.registerTool({
    name: "replace_symbol",
    label: "Replace Symbol",
    description: "Replace one or more AST symbols by name using tree-sitter ranges.",
    promptSnippet: "Use replace_symbol for complete function, method, class, or interface replacements.",
    promptGuidelines: [
      "Use replace_symbol when replacing an entire function, method, class, interface, or exported const/arrow function.",
      "Provide complete raw replacement code without hash anchors; anchors are stripped if accidentally included.",
    ],
    parameters: ReplaceSymbolSchema,
    async execute() {
      throw new Error("replace_symbol execution is not implemented yet");
    },
  });
}
