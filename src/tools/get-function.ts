import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import { GetFunctionSchema } from "./schemas.js";

const NEXT_DEFINITION_LINE = /^(export\s+)?(default\s+)?(async\s+)?(function|class|const)\b|^(def|class)\b/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findFunctionRange(lines: string[], name: string): [number, number] | undefined {
  const escaped = escapeRegExp(name);
  const startRegex = new RegExp(
    `(^\\s*(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${escaped}\\b)|` +
      `(^\\s*(export\\s+)?const\\s+${escaped}\\s*=)|` +
      `(^\\s*def\\s+${escaped}\\b)|` +
      `(^\\s*(export\\s+)?(default\\s+)?class\\s+${escaped}\\b)|` +
      `(^\\s*class\\s+${escaped}\\b)`
  );
  const start = lines.findIndex((line) => startRegex.test(line));
  if (start === -1) return undefined;

  const baseIndent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  let end = start;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      end = i;
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent && NEXT_DEFINITION_LINE.test(line.trim())) break;
    end = i;
  }

  return [start, end];
}

export function registerGetFunctionTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  pi.registerTool({
    name: "get_function",
    label: "Get Function",
    description: "Extract anchored implementations of named functions/classes from files.",
    parameters: GetFunctionSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outputs: string[] = [];

      for (const requestedPath of params.paths) {
        const absolutePath = resolve(ctx.cwd, requestedPath.replace(/^@/, ""));
        const content = await readFile(absolutePath, "utf8");
        const lines = content.split(/\r?\n/);
        const lineAnchors = anchors.reconcile(absolutePath, lines);

        for (const name of params.function_names) {
          const range = findFunctionRange(lines, name);
          if (!range) {
            outputs.push(`${requestedPath}::${name}\nNot found.`);
            continue;
          }

          const [start, end] = range;
          const body = lines.slice(start, end + 1);
          const anchored = body.map((line, offset) => formatLineWithHash(line, lineAnchors[start + offset]));
          outputs.push(
            `${requestedPath}::${name}\n[Function Hash: ${contentHash(body.join("\n"))}]\n${anchored.join("\n")}`
          );
        }
      }

      return {
        content: [{ type: "text", text: outputs.join("\n\n---\n\n") }],
        details: { paths: params.paths, function_names: params.function_names }
      };
    }
  });
}
