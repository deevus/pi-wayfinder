# Dirac Pi Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pi package that brings Dirac's token-efficient hash-anchored and AST-aware editing workflow into pi.

**Architecture:** Implement a native pi extension package, not a nested Dirac agent. The extension registers Dirac-compatible tools (`read_file`, `edit_file`, `get_file_skeleton`, `get_function`) and a configurable tool-mode system that can run additively, prefer Dirac tools, or optionally replace/deactivate pi built-ins.

**Tech Stack:** TypeScript, pi extension API, `typebox`, `@mariozechner/pi-coding-agent`, Node `fs/promises`, optional tree-sitter dependencies copied/extracted from Dirac.

---

## File Structure

Create this repository as an isolated pi package so it can be tested independently and later published or installed with `pi install /Users/sh/Projects/pi-dirac-tools`.

- Create `package.json` — npm/pi package manifest.
- Create `src/index.ts` — extension entrypoint; registers flags, commands, prompt guidance, and tools.
- Create `src/mode.ts` — mode parsing and active-tool decisions.
- Create `src/anchors/line-hashing.ts` — delimiter, hash helpers, anchor formatting/stripping.
- Create `src/anchors/AnchorStateManager.ts` — stable session-scoped anchor reconciliation.
- Create `src/tools/read-file.ts` — `read_file` tool definition.
- Create `src/tools/edit-file.ts` — `edit_file` tool definition.
- Create `src/tools/schemas.ts` — TypeBox schemas shared by tool definitions.
- Create `src/prompt.ts` — Dirac editing guidance injected into pi's system prompt.
- Create `test/*.test.ts` — unit tests for anchor reconciliation, reads, edit validation, and mode selection.
- Create `README.md` — usage and mode documentation.

## Tool Mode Model

The extension supports three modes:

```ts
export type DiracToolMode = "additive" | "preferred" | "replacement";
```

- `additive`: register Dirac tools; do not alter active tools; light prompt guidance.
- `preferred`: default; register Dirac tools and inject strong guidance to prefer `read_file` + `edit_file` for source edits.
- `replacement`: keep Dirac tools plus safe basics active; deactivate pi `read`/`edit` from the active tool set without overriding their implementations.

Hard overrides are a separate explicit flag:

```ts
export type DiracOverrideMode = "none" | "read" | "read_edit";
```

Default: `none`. This avoids surprising users who expect pi's built-ins.

---

### Task 1: Package skeleton and extension entrypoint

**Files:**
- Create: `package.json`
- Create: `src/index.ts`
- Create: `src/mode.ts`
- Create: `README.md`

- [x] **Step 1: Create package manifest**

Create `package.json`:

```json
{
  "name": "pi-dirac-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "keywords": ["pi-package", "dirac", "hash-anchored", "ast"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "diff": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "20.x",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

- [x] **Step 2: Implement mode parsing**

Create `src/mode.ts`:

```ts
export type DiracToolMode = "additive" | "preferred" | "replacement";
export type DiracOverrideMode = "none" | "read" | "read_edit";

export const DEFAULT_DIRAC_TOOL_MODE: DiracToolMode = "preferred";
export const DEFAULT_DIRAC_OVERRIDE_MODE: DiracOverrideMode = "none";

export function parseToolMode(value: unknown): DiracToolMode {
  if (value === "additive" || value === "preferred" || value === "replacement") return value;
  return DEFAULT_DIRAC_TOOL_MODE;
}

export function parseOverrideMode(value: unknown): DiracOverrideMode {
  if (value === "none" || value === "read" || value === "read_edit") return value;
  return DEFAULT_DIRAC_OVERRIDE_MODE;
}

export function activeToolsForMode(mode: DiracToolMode, currentTools: string[]): string[] {
  const diracTools = ["read_file", "edit_file", "get_file_skeleton", "get_function"];
  if (mode !== "replacement") return Array.from(new Set([...currentTools, ...diracTools]));
  const keep = currentTools.filter((name) => name !== "read" && name !== "edit");
  return Array.from(new Set([...keep, ...diracTools, "write", "bash", "grep", "find", "ls"]));
}
```

- [x] **Step 3: Implement extension entrypoint scaffold**

Create `src/index.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { activeToolsForMode, parseOverrideMode, parseToolMode } from "./mode.js";

export default function diracToolsExtension(pi: ExtensionAPI): void {
  pi.registerFlag("dirac-tools-mode", {
    description: "Dirac tools mode: additive, preferred, or replacement",
    type: "string",
    default: "preferred"
  });

  pi.registerFlag("dirac-override-builtins", {
    description: "Hard override pi built-ins: none, read, or read_edit",
    type: "string",
    default: "none"
  });

  pi.on("session_start", async (_event, ctx) => {
    const mode = parseToolMode(pi.getFlag("dirac-tools-mode"));
    const active = activeToolsForMode(mode, pi.getActiveTools());
    pi.setActiveTools(active);
    ctx.ui.setStatus("dirac-tools", `dirac:${mode}`);
  });

  pi.registerCommand("dirac-tools", {
    description: "Switch Dirac tool mode: additive, preferred, replacement",
    handler: async (args, ctx) => {
      const mode = parseToolMode(args.trim());
      pi.setActiveTools(activeToolsForMode(mode, pi.getActiveTools()));
      ctx.ui.setStatus("dirac-tools", `dirac:${mode}`);
      ctx.ui.notify(`Dirac tools mode set to ${mode}`, "info");
    }
  });

  const overrideMode = parseOverrideMode(pi.getFlag("dirac-override-builtins"));
  void overrideMode;
}
```

- [x] **Step 4: Add usage docs**

Create `README.md`:

```md
# pi-dirac-tools

Dirac-style hash-anchored and AST-aware editing tools for pi.

## Modes

- `additive`: add Dirac tools without changing pi built-ins.
- `preferred`: default; add Dirac tools and guide the model to prefer them for source edits.
- `replacement`: deactivate pi `read` and `edit` from the active toolset and use `read_file` / `edit_file` instead.

Run:

```bash
pi -e . --dirac-tools-mode preferred
pi -e . --dirac-tools-mode replacement
```

Inside pi:

```txt
/dirac-tools additive
/dirac-tools preferred
/dirac-tools replacement
```
```

- [x] **Step 5: Typecheck**

Run:

```bash
npm install && npm run typecheck
```

Expected: TypeScript completes without errors.

- [x] **Step 6: Commit**

```bash
git add .
git commit -m "feat: scaffold pi dirac tools extension"
```

---

### Task 2: Anchor manager and line hashing

**Files:**
- Create: `src/anchors/line-hashing.ts`
- Create: `src/anchors/AnchorStateManager.ts`
- Create: `test/anchors.test.ts`

- [x] **Step 1: Port line hashing helpers**

Create `src/anchors/line-hashing.ts`:

```ts
export const ANCHOR_DELIMITER = "│";

export function getDelimiter(): string {
  return ANCHOR_DELIMITER;
}

export function contentHash(content: string): string {
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) {
    h = Math.imul(h ^ content.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function formatLineWithHash(content: string, anchor: string): string {
  return `${anchor}${ANCHOR_DELIMITER}${content}`;
}

export function splitAnchor(rawAnchor: string): { anchor: string; content: string } {
  const index = rawAnchor.indexOf(ANCHOR_DELIMITER);
  if (index === -1) return { anchor: rawAnchor.trim(), content: "" };
  return {
    anchor: rawAnchor.slice(0, index).trim(),
    content: rawAnchor.slice(index + ANCHOR_DELIMITER.length)
  };
}

export function stripHashes(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const index = line.indexOf(ANCHOR_DELIMITER);
      if (index === -1) return line;
      const maybeAnchor = line.slice(0, index);
      return /^[A-Z][a-zA-Z]*$/.test(maybeAnchor) ? line.slice(index + ANCHOR_DELIMITER.length) : line;
    })
    .join("\n");
}
```

- [x] **Step 2: Implement deterministic anchor manager**

Use deterministic generated words rather than Dirac's bundled dictionary for MVP reproducibility.

Create `src/anchors/AnchorStateManager.ts`:

```ts
import * as diff from "diff";

interface TrackedDocument {
  hashes: Uint32Array;
  anchors: string[];
  nextId: number;
}

function computeHashes(lines: string[]): Uint32Array {
  const hashes = new Uint32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    let h = 2166136261;
    for (let j = 0; j < lines[i].length; j++) h = Math.imul(h ^ lines[i].charCodeAt(j), 16777619);
    hashes[i] = h >>> 0;
  }
  return hashes;
}

function anchorName(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let n = index;
  let out = "";
  do {
    out = alphabet[n % alphabet.length] + out;
    n = Math.floor(n / alphabet.length) - 1;
  } while (n >= 0);
  return `Dirac${out}`;
}

export class AnchorStateManager {
  private documents = new Map<string, TrackedDocument>();

  reconcile(absolutePath: string, currentLines: string[]): string[] {
    const currentHashes = computeHashes(currentLines);
    const tracked = this.documents.get(absolutePath);

    if (!tracked) {
      const anchors = currentLines.map((_, i) => anchorName(i));
      this.documents.set(absolutePath, { hashes: currentHashes, anchors, nextId: currentLines.length });
      return anchors;
    }

    if (tracked.hashes.length === currentHashes.length && tracked.hashes.every((h, i) => h === currentHashes[i])) {
      return tracked.anchors;
    }

    const changes = diff.diffArrays(Array.from(tracked.hashes), Array.from(currentHashes));
    const anchors: string[] = [];
    let oldIndex = 0;
    let nextId = tracked.nextId;

    for (const change of changes) {
      if (change.added) {
        for (let i = 0; i < (change.count ?? 0); i++) anchors.push(anchorName(nextId++));
      } else if (change.removed) {
        oldIndex += change.count ?? 0;
      } else {
        for (let i = 0; i < (change.count ?? 0); i++) anchors.push(tracked.anchors[oldIndex++]);
      }
    }

    this.documents.set(absolutePath, { hashes: currentHashes, anchors, nextId });
    return anchors;
  }

  getAnchors(absolutePath: string): string[] | undefined {
    return this.documents.get(absolutePath)?.anchors;
  }
}
```

- [x] **Step 3: Add anchor tests**

Create `test/anchors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { formatLineWithHash, splitAnchor, stripHashes } from "../src/anchors/line-hashing.js";

it("preserves anchors for unchanged lines across insertions", () => {
  const manager = new AnchorStateManager();
  const first = manager.reconcile("/tmp/a.ts", ["one", "two", "three"]);
  const second = manager.reconcile("/tmp/a.ts", ["one", "inserted", "two", "three"]);
  expect(second[0]).toBe(first[0]);
  expect(second[2]).toBe(first[1]);
  expect(second[3]).toBe(first[2]);
  expect(second[1]).not.toBe(first[1]);
});

it("splits and strips anchor-prefixed lines", () => {
  const line = formatLineWithHash("const x = 1", "DiracA");
  expect(splitAnchor(line)).toEqual({ anchor: "DiracA", content: "const x = 1" });
  expect(stripHashes(line)).toBe("const x = 1");
});
```

- [x] **Step 4: Run tests**

```bash
npm test
```

Expected: anchor tests pass.

- [x] **Step 5: Commit**

```bash
git add src/anchors test/anchors.test.ts
git commit -m "feat: add stable Dirac anchor manager"
```

---

### Task 3: `read_file` tool

**Files:**
- Create: `src/tools/schemas.ts`
- Create: `src/tools/read-file.ts`
- Modify: `src/index.ts`
- Create: `test/read-file.test.ts`

- [x] **Step 1: Define schemas**

Create `src/tools/schemas.ts`:

```ts
import { Type } from "typebox";

export const ReadFileSchema = Type.Object({
  paths: Type.Array(Type.String(), { description: "Relative or absolute file paths to read" }),
  start_line: Type.Optional(Type.Number({ description: "1-indexed start line" })),
  end_line: Type.Optional(Type.Number({ description: "1-indexed end line, inclusive" }))
});

export const EditFileSchema = Type.Object({
  files: Type.Array(Type.Object({
    path: Type.String(),
    edits: Type.Array(Type.Object({
      edit_type: Type.Union([
        Type.Literal("replace"),
        Type.Literal("insert_after"),
        Type.Literal("insert_before")
      ]),
      anchor: Type.String(),
      end_anchor: Type.Optional(Type.String()),
      text: Type.String()
    }))
  }))
});
```

- [x] **Step 2: Implement `read_file` factory**

Create `src/tools/read-file.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
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
```

- [x] **Step 3: Register tool in entrypoint**

Modify `src/index.ts` to create an anchor manager and register the read tool:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AnchorStateManager } from "./anchors/AnchorStateManager.js";
import { activeToolsForMode, parseOverrideMode, parseToolMode } from "./mode.js";
import { registerReadFileTool } from "./tools/read-file.js";

export default function diracToolsExtension(pi: ExtensionAPI): void {
  const anchors = new AnchorStateManager();
  registerReadFileTool(pi, anchors);

  pi.registerFlag("dirac-tools-mode", {
    description: "Dirac tools mode: additive, preferred, or replacement",
    type: "string",
    default: "preferred"
  });

  pi.registerFlag("dirac-override-builtins", {
    description: "Hard override pi built-ins: none, read, or read_edit",
    type: "string",
    default: "none"
  });

  pi.on("session_start", async (_event, ctx) => {
    const mode = parseToolMode(pi.getFlag("dirac-tools-mode"));
    pi.setActiveTools(activeToolsForMode(mode, pi.getActiveTools()));
    ctx.ui.setStatus("dirac-tools", `dirac:${mode}`);
  });

  pi.registerCommand("dirac-tools", {
    description: "Switch Dirac tool mode: additive, preferred, replacement",
    handler: async (args, ctx) => {
      const mode = parseToolMode(args.trim());
      pi.setActiveTools(activeToolsForMode(mode, pi.getActiveTools()));
      ctx.ui.setStatus("dirac-tools", `dirac:${mode}`);
      ctx.ui.notify(`Dirac tools mode set to ${mode}`, "info");
    }
  });

  const overrideMode = parseOverrideMode(pi.getFlag("dirac-override-builtins"));
  void overrideMode;
}
```

- [x] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no type errors.

- [x] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: add anchored read_file tool"
```

---

### Task 4: `edit_file` tool and replacement mode

**Files:**
- Create: `src/tools/edit-file.ts`
- Modify: `src/index.ts`
- Modify: `src/mode.ts`
- Create: `test/edit-file.test.ts`

- [x] **Step 1: Implement anchor resolution and edit application**

Create `src/tools/edit-file.ts` with these exported helpers and tool registration:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { splitAnchor, stripHashes } from "../anchors/line-hashing.js";
import { EditFileSchema } from "./schemas.js";

export interface EditOperation {
  edit_type: "replace" | "insert_after" | "insert_before";
  anchor: string;
  end_anchor?: string;
  text: string;
}

function resolveAnchor(rawAnchor: string | undefined, anchors: string[], lines: string[]): number {
  if (!rawAnchor) throw new Error("anchor is missing");
  const { anchor, content } = splitAnchor(rawAnchor);
  if (!/^[A-Z][a-zA-Z]*$/.test(anchor)) throw new Error(`invalid anchor format: ${rawAnchor}`);
  const index = anchors.indexOf(anchor);
  if (index === -1) throw new Error(`anchor not found: ${anchor}`);
  if (lines[index] !== content) throw new Error(`anchor content mismatch for ${anchor}; expected ${JSON.stringify(lines[index])}, got ${JSON.stringify(content)}`);
  return index;
}

export function applyAnchoredEdits(lines: string[], anchors: string[], edits: EditOperation[]): string[] {
  const resolved = edits.map((edit) => {
    const start = resolveAnchor(edit.anchor, anchors, lines);
    const end = edit.edit_type === "replace" ? resolveAnchor(edit.end_anchor, anchors, lines) : start;
    if (end < start) throw new Error("end_anchor must not appear before anchor");
    return { edit, start, end };
  }).sort((a, b) => b.start - a.start);

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
    promptGuidelines: ["Use edit_file for source-code edits after reading anchors with read_file, get_function, or get_file_skeleton."],
    parameters: EditFileSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const summaries: string[] = [];
      for (const file of params.files) {
        const absolutePath = resolve(ctx.cwd, file.path.replace(/^@/, ""));
        await withFileMutationQueue(absolutePath, async () => {
          const content = await readFile(absolutePath, "utf8");
          const lines = content.split(/\r?\n/);
          const currentAnchors = anchors.reconcile(absolutePath, lines);
          const nextLines = applyAnchoredEdits(lines, currentAnchors, file.edits);
          const nextContent = nextLines.join("\n");
          if (ctx.hasUI) {
            const ok = await ctx.ui.confirm("Apply Dirac edit?", `File: ${file.path}\nEdits: ${file.edits.length}`);
            if (!ok) throw new Error(`User rejected edits for ${file.path}`);
          }
          await mkdir(dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, nextContent, "utf8");
          anchors.reconcile(absolutePath, nextLines);
          summaries.push(`Updated ${file.path}: ${file.edits.length} anchored edit(s).`);
        });
      }
      return { content: [{ type: "text", text: summaries.join("\n") }], details: { files: params.files.map((f) => f.path) } };
    }
  });
}
```

- [x] **Step 2: Register `edit_file`**

Modify `src/index.ts`:

```ts
import { registerEditFileTool } from "./tools/edit-file.js";
```

Then after `registerReadFileTool(pi, anchors);` add:

```ts
registerEditFileTool(pi, anchors);
```

- [x] **Step 3: Ensure replacement mode activates `edit_file` and `read_file`**

Keep `src/mode.ts` behavior from Task 1. Replacement mode removes `read` and `edit`, then adds `read_file` and `edit_file`.

- [x] **Step 4: Add edit tests**

Create `test/edit-file.test.ts`:

```ts
import { expect, it } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../src/anchors/line-hashing.js";
import { applyAnchoredEdits } from "../src/tools/edit-file.js";

it("applies replace, insert_before, and insert_after edits", () => {
  const manager = new AnchorStateManager();
  const lines = ["one", "two", "three"];
  const anchors = manager.reconcile("/tmp/a.txt", lines);
  const next = applyAnchoredEdits(lines, anchors, [
    { edit_type: "replace", anchor: formatLineWithHash("two", anchors[1]), end_anchor: formatLineWithHash("two", anchors[1]), text: "TWO" },
    { edit_type: "insert_before", anchor: formatLineWithHash("one", anchors[0]), text: "zero" },
    { edit_type: "insert_after", anchor: formatLineWithHash("three", anchors[2]), text: "four" }
  ]);
  expect(next).toEqual(["zero", "one", "TWO", "three", "four"]);
});

it("rejects stale anchor content", () => {
  const manager = new AnchorStateManager();
  const lines = ["one", "two"];
  const anchors = manager.reconcile("/tmp/a.txt", lines);
  expect(() => applyAnchoredEdits(lines, anchors, [
    { edit_type: "replace", anchor: formatLineWithHash("wrong", anchors[0]), end_anchor: formatLineWithHash("one", anchors[0]), text: "ONE" }
  ])).toThrow(/content mismatch/);
});
```

- [x] **Step 5: Test and commit**

```bash
npm test && npm run typecheck
```

Expected: all tests pass.

```bash
git add .
git commit -m "feat: add anchored edit_file tool"
```

---

### Task 5: Prompt guidance and optional hard overrides

**Files:**
- Create: `src/prompt.ts`
- Modify: `src/index.ts`
- Modify: `README.md`

- [x] **Step 1: Add prompt guidance**

Create `src/prompt.ts`:

```ts
import type { DiracToolMode } from "./mode.js";

export function getDiracPromptGuidance(mode: DiracToolMode): string {
  const base = `
## Dirac-style source editing

When editing existing source files, prefer this workflow:
1. Use read_file, get_file_skeleton, or get_function to obtain stable anchors.
2. Use edit_file for targeted source edits.
3. Batch non-overlapping edits across files in one edit_file call.
4. Use pi built-in edit/write only when anchors are unnecessary, such as small config files or brand-new files.

Anchor rules:
- Anchors have the form AnchorWord│exact line content.
- Always include the full anchored line as anchor/end_anchor.
- edit_file text must contain raw final code without anchors.
`;

  if (mode === "replacement") {
    return `${base}\nReplacement mode is active. Treat read_file and edit_file as the primary file read/edit tools for existing source files.`;
  }
  if (mode === "additive") {
    return `${base}\nAdditive mode is active. Dirac tools are available when precision matters.`;
  }
  return `${base}\nPreferred mode is active. Prefer Dirac tools for source-code reads and edits.`;
}
```

- [x] **Step 2: Inject guidance before agent start**

Modify `src/index.ts`:

```ts
import { getDiracPromptGuidance } from "./prompt.js";
```

Add handler:

```ts
pi.on("before_agent_start", async (event) => {
  const mode = parseToolMode(pi.getFlag("dirac-tools-mode"));
  return { systemPrompt: `${event.systemPrompt}\n\n${getDiracPromptGuidance(mode)}` };
});
```

- [x] **Step 3: Add hard override registration behind explicit flag**

Do not implement hard override in the first release. Add documentation that hard override is reserved for a follow-up because replacement mode already removes `read` and `edit` from active tools without changing built-in semantics.

- [x] **Step 4: Update README mode docs**

Add this paragraph to `README.md`:

```md
## Built-in replacement

`replacement` mode is a soft replacement: it removes pi `read` and `edit` from the active toolset and activates Dirac `read_file` and `edit_file`. It does not override pi's built-in implementations. This is the safest idiomatic pi behavior.

A future explicit `--dirac-override-builtins read_edit` mode can register tools named `read` and `edit`, but that is intentionally separate because overriding built-ins can surprise existing workflows.
```

- [x] **Step 5: Typecheck and commit**

```bash
npm run typecheck
```

Expected: no type errors.

```bash
git add .
git commit -m "feat: add Dirac prompt guidance and replacement mode docs"
```

---

### Task 6: AST read tools MVP

**Files:**
- Create: `src/tools/get-file-skeleton.ts`
- Create: `src/tools/get-function.ts`
- Modify: `src/index.ts`
- Modify: `src/tools/schemas.ts`
- Create: `test/ast-tools.test.ts`

- [x] **Step 1: Add schemas**

Append to `src/tools/schemas.ts`:

```ts
export const GetFileSkeletonSchema = Type.Object({
  paths: Type.Array(Type.String())
});

export const GetFunctionSchema = Type.Object({
  paths: Type.Array(Type.String()),
  function_names: Type.Array(Type.String())
});
```

- [x] **Step 2: Implement regex-based AST MVP**

For the MVP, implement a conservative parser-free version for TypeScript/JavaScript/Python that extracts common function/class definition lines. Tree-sitter is added after the tool contract is proven.

Create `src/tools/get-file-skeleton.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../anchors/line-hashing.js";
import { GetFileSkeletonSchema } from "./schemas.js";

const DEFINITION_LINE = /^\s*(export\s+)?(async\s+)?(function\s+\w+|class\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(|def\s+\w+|class\s+\w+)/;

export function registerGetFileSkeletonTool(pi: ExtensionAPI, anchors: AnchorStateManager): void {
  pi.registerTool({
    name: "get_file_skeleton",
    label: "Get File Skeleton",
    description: "Return a compact anchored outline of function/class definition lines.",
    parameters: GetFileSkeletonSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outputs: string[] = [];
      for (const requestedPath of params.paths) {
        const absolutePath = resolve(ctx.cwd, requestedPath.replace(/^@/, ""));
        const content = await readFile(absolutePath, "utf8");
        const lines = content.split(/\r?\n/);
        const lineAnchors = anchors.reconcile(absolutePath, lines);
        const skeleton = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => DEFINITION_LINE.test(line))
          .map(({ line, index }) => formatLineWithHash(line, lineAnchors[index]));
        outputs.push(`--- ${requestedPath} ---\n${skeleton.length ? skeleton.join("\n") : "No definitions found."}`);
      }
      return { content: [{ type: "text", text: outputs.join("\n\n") }], details: { paths: params.paths } };
    }
  });
}
```

- [x] **Step 3: Implement conservative `get_function` MVP**

Create `src/tools/get-function.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import { GetFunctionSchema } from "./schemas.js";

function findFunctionRange(lines: string[], name: string): [number, number] | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRegex = new RegExp(`(^\\s*(export\\s+)?(async\\s+)?function\\s+${escaped}\\b)|(^\\s*(export\\s+)?const\\s+${escaped}\\s*=)|(^\\s*def\\s+${escaped}\\b)|(^\\s*class\\s+${escaped}\\b)`);
  const start = lines.findIndex((line) => startRegex.test(line));
  if (start === -1) return undefined;
  const baseIndent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") { end = i; continue; }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent && /^(export\s+)?(async\s+)?(function|class|const)|^(def|class)\b/.test(line.trim())) break;
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
          outputs.push(`${requestedPath}::${name}\n[Function Hash: ${contentHash(body.join("\n"))}]\n${anchored.join("\n")}`);
        }
      }
      return { content: [{ type: "text", text: outputs.join("\n\n---\n\n") }], details: { paths: params.paths, function_names: params.function_names } };
    }
  });
}
```

- [x] **Step 4: Register AST tools**

Modify `src/index.ts`:

```ts
import { registerGetFileSkeletonTool } from "./tools/get-file-skeleton.js";
import { registerGetFunctionTool } from "./tools/get-function.js";
```

After `registerEditFileTool(pi, anchors);` add:

```ts
registerGetFileSkeletonTool(pi, anchors);
registerGetFunctionTool(pi, anchors);
```

- [x] **Step 5: Test and commit**

```bash
npm test && npm run typecheck
```

Expected: all tests pass.

```bash
git add .
git commit -m "feat: add Dirac AST context tool MVPs"
```

---

### Task 7: Verification and manual smoke test

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run package checks**

```bash
npm test && npm run typecheck
```

Expected: tests pass and TypeScript reports no errors.

- [ ] **Step 2: Run pi smoke test in additive mode**

From repo root:

```bash
pi -e . --dirac-tools-mode additive -p "Use read_file on README.md and summarize the first 20 lines."
```

Expected: pi loads the extension, model can call `read_file`, and output includes anchored file content or a summary derived from it.

- [ ] **Step 3: Run pi smoke test in replacement mode**

```bash
pi -e . --dirac-tools-mode replacement -p "Use read_file on README.md and report whether Dirac mentions hash-anchored edits."
```

Expected: active tools exclude `read` and `edit`, include `read_file` and `edit_file`, and the model uses Dirac tools.

- [ ] **Step 4: Document smoke commands**

Append to `README.md`:

```md
## Smoke tests

```bash
pi -e . --dirac-tools-mode additive -p "Use read_file on README.md and summarize the first 20 lines."
pi -e . --dirac-tools-mode replacement -p "Use read_file on README.md and report whether Dirac mentions hash-anchored edits."
```
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add pi dirac tools smoke tests"
```

---

## Follow-up Plan After MVP

After the MVP is working, create separate plans for these independent additions:

1. Tree-sitter-backed `get_file_skeleton` and `get_function` parity with Dirac's `ASTAnchorBridge`.
2. `replace_symbol` with AST range replacement.
3. `find_symbol_references` and `rename_symbol` using scoped scans first, persistent symbol index second.
4. Custom TUI renderers for anchored reads and diffs.
5. Eval harness comparing stock pi, pi plus Dirac tools, and full Dirac.

## Self-Review

- Spec coverage: includes native pi package, Dirac-compatible tool names, optional replacement mode, anchored read/edit MVP, AST context MVP, prompt guidance, tests, docs, and smoke checks.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: `DiracToolMode`, `DiracOverrideMode`, `AnchorStateManager`, `registerReadFileTool`, `registerEditFileTool`, `registerGetFileSkeletonTool`, and `registerGetFunctionTool` names are consistent across tasks.
