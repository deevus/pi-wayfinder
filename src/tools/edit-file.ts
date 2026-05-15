import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { ANCHOR_DELIMITER, splitAnchor, stripHashes } from "../anchors/line-hashing.js";
import { combineDiffs, createUnifiedDiff, type DiffDetails } from "../rendering/diff-output.js";
import { renderCodeLikeCall, renderDiffResult } from "../rendering/pi-renderers.js";
import { EditFileSchema } from "./schemas.js";

export interface EditOperation {
  edit_type: "replace" | "replace_range" | "insert_after" | "insert_before";
  anchor: string;
  end_anchor?: string;
  text: string;
}

interface ResolvedEdit {
  edit: EditOperation;
  start: number;
  end: number;
}

interface EditFileToolDetails {
  files: string[];
  diff: string;
  diffs: DiffDetails[];
  firstChangedLine?: number;
}

function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.match(/\r\n|\n/)?.[0] === "\r\n" ? "\r\n" : "\n";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("edit_file aborted");
}

function resolveAnchor(rawAnchor: string | undefined, anchors: string[], lines: string[], fieldName = "anchor"): number {
  if (!rawAnchor) throw new Error(`${fieldName} is missing`);
  if (!rawAnchor.includes(ANCHOR_DELIMITER)) {
    throw new Error(`${fieldName} must be a raw anchored line in the form AnchorWord${ANCHOR_DELIMITER}exact line content`);
  }

  const { anchor, content } = splitAnchor(rawAnchor);
  if (!/^[A-Z][a-zA-Z]*$/.test(anchor)) throw new Error(`invalid anchor format: ${rawAnchor}`);

  const index = anchors.indexOf(anchor);
  if (index === -1) throw new Error(`anchor not found: ${anchor}`);
  if (lines[index] !== content) {
    throw new Error(
      `anchor content mismatch for ${anchor}; expected ${JSON.stringify(lines[index])}, got ${JSON.stringify(content)}`
    );
  }
  return index;
}

export function applyAnchoredEdits(lines: string[], anchors: string[], edits: EditOperation[]): string[] {
  const resolved: ResolvedEdit[] = edits
    .map((edit) => {
      const start = resolveAnchor(edit.anchor, anchors, lines, "anchor");
      let end = start;
      if (edit.edit_type === "replace_range") {
        if (!edit.end_anchor) throw new Error("end_anchor is required for replace_range edits");
        end = resolveAnchor(edit.end_anchor, anchors, lines, "end_anchor");
      } else if (edit.edit_type === "replace" && edit.end_anchor) {
        end = resolveAnchor(edit.end_anchor, anchors, lines, "end_anchor");
      }
      if (end < start) throw new Error("end_anchor must not appear before anchor");
      return { edit, start, end };
    })
    .sort((a, b) => b.start - a.start);

  for (let i = 0; i < resolved.length - 1; i++) {
    const earlier = resolved[i + 1];
    const later = resolved[i];
    if (earlier.end >= later.start) throw new Error("overlapping edits are not allowed");
  }

  const next = [...lines];
  for (const { edit, start, end } of resolved) {
    const replacement = stripHashes(edit.text);
    const replacementLines = replacement === "" ? [] : replacement.split(/\r?\n/);

    if (edit.edit_type === "insert_after") next.splice(start + 1, 0, ...replacementLines);
    else if (edit.edit_type === "insert_before") next.splice(start, 0, ...replacementLines);
    else next.splice(start, end - start + 1, ...replacementLines);
  }

  return next;
}

export function registerEditFileTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  pi.registerTool({
    name: "edit_file",
    label: "Edit File Anchored",
    description: "Apply batched multi-file edits using stable anchors returned by read_file or AST tools.",
    promptSnippet: "Edit existing source files using stable anchors from read_file/get_function/get_file_skeleton.",
    promptGuidelines: [
      "Use edit_file for source-code edits after reading anchors with read_file, get_function, or get_file_skeleton."
    ],
    parameters: EditFileSchema,
    renderCall(args, theme) {
      const files = Array.isArray(args.files) ? args.files.map((file) => file.path).filter((path): path is string => typeof path === "string") : [];
      return renderCodeLikeCall("edit_file", files, theme);
    },
    renderResult(result, options, theme, context) {
      return renderDiffResult(result as never, options, theme, context, "Editing");
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const summaries: string[] = [];
      const diffs: DiffDetails[] = [];
      const failures: string[] = [];

      for (const file of params.files) {
        throwIfAborted(signal);
        const absolutePath = resolve(ctx.cwd, file.path.replace(/^@/, ""));

        try {
          await withFileMutationQueue(absolutePath, async () => {
            throwIfAborted(signal);
            const content = await readFile(absolutePath, { encoding: "utf8", signal });
            throwIfAborted(signal);

            const lineEnding = detectLineEnding(content);
            const lines = content.split(/\r?\n/);
            const currentAnchors = anchors.reconcile(absolutePath, lines);

            throwIfAborted(signal);
            const nextLines = applyAnchoredEdits(lines, currentAnchors, file.edits);
            throwIfAborted(signal);
            const nextContent = nextLines.join(lineEnding);
            const diff = createUnifiedDiff(file.path, content, nextContent);
            if (diff.diff) diffs.push(diff);

            throwIfAborted(signal);
            await mkdir(dirname(absolutePath), { recursive: true });
            throwIfAborted(signal);
            await writeFile(absolutePath, nextContent, { encoding: "utf8", signal });
            anchors.reconcile(absolutePath, nextLines);
            summaries.push(`Updated ${file.path}: ${file.edits.length} anchored edit(s).`);
          });
        } catch (error) {
          throwIfAborted(signal);
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`Failed ${file.path}: ${message}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(failures.join("\n"));
      }

      return {
        content: [{ type: "text", text: summaries.join("\n") }],
        details: {
          files: params.files.map((file) => file.path),
          diffs,
          diff: combineDiffs(diffs),
          firstChangedLine: diffs[0]?.firstChangedLine
        } satisfies EditFileToolDetails
      };
    }
  });
}
