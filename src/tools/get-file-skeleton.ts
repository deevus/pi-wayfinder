import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../anchors/line-hashing.js";
import { appendOutputLine, appendTruncationNotice, createOutputAccumulator, throwIfAborted } from "./output-limits.js";
import { GetFileSkeletonSchema } from "./schemas.js";

const DEFINITION_LINE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\s+\w+|class\s+\w+|const\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)?\s*=>?|def\s+\w+)/;

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

        const absolutePath = resolve(ctx.cwd, requestedPath.replace(/^@/, ""));
        const content = await readFile(absolutePath, { encoding: "utf8", signal });
        const lines = content.split(/\r?\n/);
        const lineAnchors = anchors.reconcile(absolutePath, lines);
        const skeleton = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => DEFINITION_LINE.test(line))
          .map(({ line, index }) => formatLineWithHash(line, lineAnchors[index]));

        if (!isFirstFile) appendOutputLine(output, "");
        appendOutputLine(output, `--- ${requestedPath} ---`);
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
        details: { paths: params.paths }
      };
    }
  });
}
