import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import { ReadFileSchema } from "./schemas.js";

const MAX_OUTPUT_LINES = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024;

interface OutputAccumulator {
  parts: string[];
  lineCount: number;
  byteCount: number;
  truncated: boolean;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("read_file aborted");
}

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

function appendOutputLine(output: OutputAccumulator, line: string): boolean {
  if (output.truncated) return false;
  if (output.lineCount >= MAX_OUTPUT_LINES) {
    output.truncated = true;
    return false;
  }

  const separatorBytes = output.lineCount === 0 ? 0 : Buffer.byteLength("\n", "utf8");
  const lineBytes = Buffer.byteLength(line, "utf8");
  if (output.byteCount + separatorBytes + lineBytes > MAX_OUTPUT_BYTES) {
    output.truncated = true;
    return false;
  }

  if (output.lineCount > 0) output.parts.push("\n");
  output.parts.push(line);
  output.lineCount++;
  output.byteCount += separatorBytes + lineBytes;
  return true;
}

function appendTruncationNotice(text: string, output: OutputAccumulator): string {
  if (!output.truncated) return text;

  const notice = `[Output truncated: showing the first ${output.lineCount} lines within ${MAX_OUTPUT_BYTES} bytes. Narrow the read with start_line/end_line to inspect omitted content.]`;
  return text.length > 0 ? `${text}\n\n${notice}` : notice;
}

export function registerReadFileTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  pi.registerTool({
    name: "read_file",
    label: "Read File Anchored",
    description: "Read one or more files and return stable line anchors for use with edit_file.",
    promptSnippet: "Read source files with stable line anchors for precise edit_file operations.",
    promptGuidelines: ["Use read_file before edit_file when changing existing source files."],
    parameters: ReadFileSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const output: OutputAccumulator = { parts: [], lineCount: 0, byteCount: 0, truncated: false };
      let isFirstFile = true;

      for (const requestedPath of params.paths) {
        throwIfAborted(signal);

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
