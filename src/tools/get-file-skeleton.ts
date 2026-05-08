import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../anchors/line-hashing.js";
import { ASTAnchorBridge } from "../ast/ast-anchor-bridge.js";
import { appendOutputLine, appendTruncationNotice, createOutputAccumulator, throwIfAborted } from "./output-limits.js";
import { GetFileSkeletonSchema } from "./schemas.js";

const DEFINITION_LINE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\s+\w+|class\s+\w+|const\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)?\s*=>?|def\s+\w+)/;

function getRegexSkeleton(content: string, absolutePath: string, anchors: AnchorStateManager): string[] {
  const lines = content.split(/\r?\n/);
  const lineAnchors = anchors.reconcile(absolutePath, lines);

  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => DEFINITION_LINE.test(line))
    .map(({ line, index }) => formatLineWithHash(line, lineAnchors[index]));
}

function appendText(output: ReturnType<typeof createOutputAccumulator>, text: string): void {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  for (const line of lines) {
    if (!appendOutputLine(output, line)) break;
  }
}

export function registerGetFileSkeletonTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  pi.registerTool({
    name: "get_file_skeleton",
    label: "Get File Skeleton",
    description: "Return a compact anchored outline of function/class definition lines.",
    parameters: GetFileSkeletonSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const output = createOutputAccumulator();
      let isFirstFile = true;

      for (const requestedPath of params.paths) {
        throwIfAborted(signal, "get_file_skeleton aborted");

        const normalizedPath = requestedPath.replace(/^@/, "");
        const absolutePath = resolve(ctx.cwd, normalizedPath);

        if (!isFirstFile) appendOutputLine(output, "");
        appendOutputLine(output, `--- ${requestedPath} ---`);

        let astSkeleton: string | null = null;
        try {
          astSkeleton = await ASTAnchorBridge.getFileSkeleton(absolutePath, anchors);
        } catch {
          astSkeleton = null;
        }
        throwIfAborted(signal, "get_file_skeleton aborted");

        if (astSkeleton) {
          appendText(output, astSkeleton);
          isFirstFile = false;
          continue;
        }

        const content = await readFile(absolutePath, { encoding: "utf8", signal });
        const skeleton = getRegexSkeleton(content, absolutePath, anchors);

        if (skeleton.length) {
          for (const line of skeleton) {
            if (!appendOutputLine(output, line)) break;
          }
        } else {
          appendOutputLine(output, "No definitions found.");
        }

        isFirstFile = false;
      }

      return {
        content: [{ type: "text", text: appendTruncationNotice(output.parts.join(""), output) }],
        details: { paths: params.paths },
      };
    },
  });
}
