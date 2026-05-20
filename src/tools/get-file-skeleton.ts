import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../anchors/line-hashing.js";
import { ASTAnchorBridge } from "../ast/ast-anchor-bridge.js";
import { renderCodeLikeCall, renderCodeLikeResult } from "../rendering/pi-renderers.js";
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
    description: "First-pass source exploration: return a compact anchored outline of functions, classes, methods, and exports before reading full files.",
    promptSnippet: "Use get_file_skeleton first when exploring source code so you can choose targeted get_function reads instead of broad file reads.",
    promptGuidelines: [
      "Call get_file_skeleton before read_file when you need to understand the structure of a source file.",
      "After reviewing the skeleton, call get_function for the specific symbols that matter."
    ],
    parameters: GetFileSkeletonSchema,
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      return renderCodeLikeCall("get_file_skeleton", paths, theme);
    },
    renderResult(result, options, theme, context) {
      return renderCodeLikeResult(result, options, theme, context);
    },
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
