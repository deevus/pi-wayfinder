import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import { ReadFileSchema } from "./schemas.js";

export function registerReadFileTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  pi.registerTool({
    name: "read_file",
    label: "Read File Anchored",
    description: "Read one or more files and return stable line anchors for use with edit_file.",
    promptSnippet: "Read source files with stable line anchors for precise edit_file operations.",
    promptGuidelines: ["Use read_file before edit_file when changing existing source files."],
    parameters: ReadFileSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outputs: string[] = [];
      for (const requestedPath of params.paths) {
        const absolutePath = resolve(ctx.cwd, requestedPath.replace(/^@/, ""));
        const content = await readFile(absolutePath, "utf8");
        const lines = content.split(/\r?\n/);
        const lineAnchors = anchors.reconcile(absolutePath, lines);
        const start = Math.max(1, params.start_line ?? 1);
        const end = Math.min(lines.length, params.end_line ?? lines.length);
        const selected = lines.slice(start - 1, end).map((line, index) => {
          const lineIndex = start - 1 + index;
          return formatLineWithHash(line, lineAnchors[lineIndex]);
        });
        outputs.push(`--- ${requestedPath} ---\n[File Hash: ${contentHash(content)}]\n${selected.join("\n")}`);
      }
      return {
        content: [{ type: "text", text: outputs.join("\n\n") }],
        details: { paths: params.paths }
      };
    }
  });
}
