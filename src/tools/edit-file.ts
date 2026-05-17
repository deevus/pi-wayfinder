import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
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

export interface EditFailureDetails {
  path?: string;
  anchor?: string;
  line?: number;
  fieldName?: string;
  currentContent?: string;
  requestedContent?: string;
  message: string;
}

class EditFileError extends Error {
  constructor(
    message: string,
    readonly failure: EditFailureDetails
  ) {
    super(message);
    this.name = "EditFileError";
  }
}

interface EditFileToolDetails {
  files: string[];
  diff: string;
  diffs: DiffDetails[];
  firstChangedLine?: number;
  failures?: EditFailureDetails[];
}

interface StagedFileEdit {
  path: string;
  absolutePath: string;
  nextLines: string[];
  nextContent: string;
  diff: DiffDetails;
  editCount: number;
}

function canonicalTargetKey(absolutePath: string): string {
  const resolvedPath = resolve(absolutePath);
  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.match(/\r\n|\n/)?.[0] === "\r\n" ? "\r\n" : "\n";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("edit_file aborted");
}

async function withFileMutationQueues<T>(canonicalTargetKeys: string[], fn: () => Promise<T>): Promise<T> {
  const uniqueKeys = Array.from(new Set(canonicalTargetKeys)).sort();

  const runWithQueue = async (index: number): Promise<T> => {
    if (index >= uniqueKeys.length) return fn();
    return withFileMutationQueue(uniqueKeys[index], () => runWithQueue(index + 1));
  };

  return runWithQueue(0);
}

function resolveAnchor(rawAnchor: string | undefined, anchors: string[], lines: string[], fieldName = "anchor"): number {
  if (!rawAnchor) {
    throw new EditFileError(`${fieldName} is missing`, { fieldName, message: `${fieldName} is missing` });
  }
  if (!rawAnchor.includes(ANCHOR_DELIMITER)) {
    const message = `${fieldName} must be a raw anchored line in the form AnchorWord${ANCHOR_DELIMITER}exact line content`;
    throw new EditFileError(message, { fieldName, message });
  }

  const { anchor, content } = splitAnchor(rawAnchor);
  if (!/^[A-Z][a-zA-Z]*$/.test(anchor)) {
    const message = `${fieldName} has invalid hash format`;
    throw new EditFileError(message, { anchor, fieldName, requestedContent: content, message });
  }

  const index = anchors.indexOf(anchor);
  if (index === -1) {
    const message = `anchor not found; requested ${JSON.stringify(content)}`;
    throw new EditFileError(message, { anchor, fieldName, requestedContent: content, message });
  }

  if (lines[index] !== content) {
    const line = index + 1;
    const message = `anchor content mismatch at line ${line}; current ${JSON.stringify(lines[index])}, requested ${JSON.stringify(content)}`;
    throw new EditFileError(message, {
      anchor,
      line,
      fieldName,
      currentContent: lines[index],
      requestedContent: content,
      message
    });
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
      const fileTargets = params.files.map((file) => {
        const absolutePath = resolve(ctx.cwd, file.path.replace(/^@/, ""));
        return {
          file,
          absolutePath,
          canonicalKey: canonicalTargetKey(absolutePath)
        };
      });
      const seenPaths = new Set<string>();
      for (const { absolutePath, canonicalKey } of fileTargets) {
        if (seenPaths.has(canonicalKey)) throw new Error(`duplicate edit_file target path: ${absolutePath}`);
        seenPaths.add(canonicalKey);
      }

      const staged: StagedFileEdit[] = [];

      await withFileMutationQueues(fileTargets.map((target) => target.canonicalKey), async () => {
        const failures: EditFailureDetails[] = [];

        for (const { file, absolutePath } of fileTargets) {
          throwIfAborted(signal);

          try {
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

            staged.push({
              path: file.path,
              absolutePath,
              nextLines,
              nextContent,
              diff,
              editCount: file.edits.length
            });
          } catch (error) {
            throwIfAborted(signal);
            const message = error instanceof Error ? error.message : String(error);
            const failure = error instanceof EditFileError ? error.failure : { message };
            failures.push({ ...failure, path: file.path, message: `Failed ${file.path}: ${message}` });
          }
        }

        if (failures.length > 0) {
          const error = new Error(failures.map((failure) => failure.message).join("\n"));
          (error as Error & { details?: EditFileToolDetails }).details = {
            files: params.files.map((file) => file.path),
            diffs: [],
            diff: "",
            failures
          };
          throw error;
        }

        for (const item of staged) {
          throwIfAborted(signal);
          await mkdir(dirname(item.absolutePath), { recursive: true });
          throwIfAborted(signal);
          await writeFile(item.absolutePath, item.nextContent, { encoding: "utf8", signal });
          anchors.reconcile(item.absolutePath, item.nextLines);
        }
      });

      const diffs = staged.map((item) => item.diff).filter((diff) => diff.diff);
      const summaries = staged.map((item) => `Updated ${item.path}: ${item.editCount} anchored edit(s).`);

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
