import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { stripHashes } from "../anchors/line-hashing.js";
import { ASTAnchorBridge, type SymbolRange } from "../ast/ast-anchor-bridge.js";
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("replace_symbol aborted");
}

function missingSymbolMessage(replacement: SymbolReplacement): string {
  return `Symbol '${replacement.symbol}'${replacement.type ? ` of type '${replacement.type}'` : ""} not found in ${replacement.path}.`;
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
    async execute(_id, params, signal, _onUpdate, ctx) {
      const replacements = params.replacements as SymbolReplacement[] | undefined;
      if (!Array.isArray(replacements) || replacements.length === 0) {
        throw new Error("Missing required parameter: replacements");
      }

      const batches = groupReplacementsByPath(replacements, ctx.cwd);
      const summaries: string[] = [];

      for (const batch of batches) {
        throwIfAborted(signal);
        await withFileMutationQueue(batch.absolutePath, async () => {
          throwIfAborted(signal);
          const originalContent = await readFile(batch.absolutePath, { encoding: "utf8", signal });
          const lineEnding = detectLineEnding(originalContent);
          const originalLines = originalContent.split(/\r?\n/);
          anchors.reconcile(batch.absolutePath, originalLines);

          const resolved: ResolvedSymbolReplacement[] = [];
          for (const replacement of batch.replacements) {
            throwIfAborted(signal);
            const range = await ASTAnchorBridge.getSymbolRange(batch.absolutePath, replacement.symbol, anchors, replacement.type);
            if (!range) throw new Error(missingSymbolMessage(replacement));
            resolved.push({ replacement, range });
          }

          throwIfAborted(signal);
          const finalContent = applyResolvedSymbolReplacements(originalContent, resolved, lineEnding);

          if (ctx.hasUI) {
            throwIfAborted(signal);
            const symbolList = batch.replacements.map((replacement) => replacement.symbol).join(", ");
            const ok = await ctx.ui.confirm("Apply Dirac symbol replacement?", `File: ${batch.displayPath}\nSymbols: ${symbolList}`, { signal });
            throwIfAborted(signal);
            if (!ok) throw new Error(`User rejected symbol replacements for ${batch.displayPath}`);
          }

          throwIfAborted(signal);
          await mkdir(dirname(batch.absolutePath), { recursive: true });
          throwIfAborted(signal);
          await writeFile(batch.absolutePath, finalContent, { encoding: "utf8", signal });
          anchors.reconcile(batch.absolutePath, finalContent.split(/\r?\n/));

          const symbolList = batch.replacements.map((replacement) => `'${replacement.symbol}'`).join(", ");
          summaries.push(`Successfully replaced symbols ${symbolList} in ${batch.displayPath}. Any existing hash anchors for these symbols are now stale.`);
        });
      }

      return {
        content: [{ type: "text", text: summaries.join("\n\n") }],
        details: {
          paths: batches.map((batch) => batch.displayPath),
          symbols: replacements.map((replacement) => replacement.symbol),
        },
      };
    },
  });
}
