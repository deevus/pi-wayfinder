import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import { renderCodeLikeCall, renderCodeLikeResult } from "../rendering/pi-renderers.js";
import { appendOutputLine, appendTruncationNotice, createOutputAccumulator, throwIfAborted } from "./output-limits.js";
import { ReadFileSchema } from "./schemas.js";

function validateLineParameter(name: "start_line" | "end_line", value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  if (value < 1) throw new Error(`${name} must be at least 1`);
}

function resolveLineRange(params: { start_line?: number; end_line?: number }, totalLines: number): { start: number; end: number } {
  validateLineParameter("start_line", params.start_line);
  validateLineParameter("end_line", params.end_line);

  const start = params.start_line ?? 1;
  const requestedEnd = params.end_line ?? totalLines;

  if (params.end_line !== undefined && start > requestedEnd) {
    throw new Error("start_line must be less than or equal to end_line");
  }
  if (start > totalLines) throw new Error(`start_line ${start} is beyond end of file (${totalLines} lines)`);

  return { start, end: Math.min(totalLines, requestedEnd) };
}

export function registerReadFileTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  pi.registerTool({
    name: "read_file",
    label: "Read File Anchored",
    description: "Read one or more files and return stable line anchors for use with edit_file.",
    promptSnippet: "Read source files with stable line anchors for precise edit_file operations.",
    promptGuidelines: ["Use read_file before edit_file when changing existing source files."],
    parameters: ReadFileSchema,
    renderCall(args, theme) {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      const start = typeof args.start_line === "number" ? args.start_line : undefined;
      const end = typeof args.end_line === "number" ? args.end_line : undefined;
      const suffix = start || end ? theme.fg("warning", `:${start ?? 1}${end ? `-${end}` : ""}`) : "";
      return renderCodeLikeCall("read_file", paths, theme, suffix);
    },
    renderResult(result, options, theme, context) {
      return renderCodeLikeResult(result, options, theme, context);
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const output = createOutputAccumulator();
      let isFirstFile = true;

      for (const requestedPath of params.paths) {
        throwIfAborted(signal, "read_file aborted");

        const absolutePath = resolve(ctx.cwd, requestedPath.replace(/^@/, ""));
        const content = await readFile(absolutePath, { encoding: "utf8", signal });
        const lines = content.split(/\r?\n/);
        const lineAnchors = anchors.reconcile(absolutePath, lines);
        const { start, end } = resolveLineRange(params, lines.length);

        if (!output.truncated) {
          if (!isFirstFile) appendOutputLine(output, "");
          appendOutputLine(output, `--- ${requestedPath} ---`);
          appendOutputLine(output, `[File Hash: ${contentHash(content)}]`);

          for (let lineIndex = start - 1; lineIndex < end; lineIndex++) {
            if (!appendOutputLine(output, formatLineWithHash(lines[lineIndex], lineAnchors[lineIndex]))) break;
          }
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
