# Phase 3 Find References and Rename Symbol Design

## Goal

Add pi-native `find_symbol_references` and `rename_symbol` tools to `pi-dirac-tools`, mirroring Dirac's useful symbol workflows while keeping the package lightweight, portable, and idiomatic for pi.

Phase 3 should provide practical source navigation and safe symbol renames without adding a persistent index or native dependencies.

## Context

Dirac implements both tools through `SymbolIndexService`, a persistent SQLite-backed project index. That design fits Dirac's IDE-like runtime, but it is heavier than this pi package needs right now.

`pi-dirac-tools` already has:

- tree-sitter parser loading for all supported query languages;
- query captures for definitions and references;
- hash anchor formatting;
- file mutation queues;
- multi-file prepare-before-write behavior in `replace_symbol`.

Phase 3 should reuse those pieces and add a shared symbol-scanning layer.

## Source References

Dirac behavior to mirror conceptually:

- `/Users/sh/Projects/dirac/src/core/task/tools/handlers/FindSymbolReferencesToolHandler.ts`
- `/Users/sh/Projects/dirac/src/core/task/tools/handlers/RenameSymbolToolHandler.ts`
- `/Users/sh/Projects/dirac/src/services/symbol-index/SymbolIndexService.ts`
- `/Users/sh/Projects/dirac/src/core/prompts/system-prompt/tools/find_symbol_references.ts`
- `/Users/sh/Projects/dirac/src/core/prompts/system-prompt/tools/rename_symbol.ts`

Do not import Dirac code directly. Copy/adapt concepts into standalone `pi-dirac-tools` modules.

## Public APIs

### `find_symbol_references`

Request shape stays Dirac-compatible:

```json
{
  "paths": ["src/", "test/"],
  "symbols": ["calculateTotal", "UserAccount"],
  "find_type": "both"
}
```

Parameters:

- `paths` — required array of relative or absolute files/directories to search. Leading `@` is stripped before path resolution.
- `symbols` — required array of exact symbol names to find.
- `find_type` — optional; one of `definition`, `reference`, or `both`; default `both`.

Output mirrors Dirac's shape: files grouped in deterministic path order, with matching lines formatted with stable hash anchors:

```text
src/sample.ts:
  (calculateTotal) Anchor│export function calculateTotal(items: Item[]) {
  (calculateTotal) Berry│  return calculateTotal(items)
```

No output cap is added in Phase 3. Output limiting is left for a later cross-tool polish phase.

### `rename_symbol`

Request shape stays Dirac-compatible and single-rename:

```json
{
  "paths": ["src/", "test/"],
  "existing_symbol": "calculateTotal",
  "new_symbol": "calculateGrandTotal"
}
```

Parameters:

- `paths` — required array of relative or absolute files/directories to rename within. Leading `@` is stripped before path resolution.
- `existing_symbol` — required exact symbol text to rename.
- `new_symbol` — required replacement text.

`rename_symbol` always renames both definitions and references. Phase 3 does not add an option to rename only definitions or only references.

Phase 3 does not validate `new_symbol`; it follows Dirac's permissive behavior and lets the caller provide the desired replacement text.

## Architecture

Add a shared symbol scanner under `src/symbols/`:

- `symbol-scanner.ts`
  - resolves requested files/directories;
  - walks directories recursively;
  - skips large/generated/noisy paths;
  - parses supported files with the existing tree-sitter loader;
  - extracts `name.definition*` and `name.reference` captures;
  - returns `SymbolLocation[]` records.
- `symbol-cache.ts`
  - stores per-file scan results in memory;
  - keys entries by absolute path plus `mtimeMs` and `size`;
  - invalidates automatically when file metadata changes;
  - resets on extension reload or process restart.

No persistent index is used. No `better-sqlite3` or other native dependency is added.

The scanner should support all language extensions already supported by Phase 1 tree-sitter queries:

- `ts`, `tsx`, `js`, `jsx`, `py`, `rs`, `go`, `c`, `h`, `cpp`, `hpp`, `cs`, `rb`, `java`, `php`, `swift`, `kt`.

## Symbol Location Model

Use a compact internal type similar to Dirac's `SymbolLocation`:

```ts
interface SymbolLocation {
  absolutePath: string;
  displayPath: string;
  name: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  type: "definition" | "reference";
  kind?: string;
}
```

`kind` is derived from the query capture suffix, for example `function`, `method`, `class`, or `interface`.

Matching is exact on `name`, matching Dirac's index lookup. Phase 3 does not implement fuzzy matching, qualified-name matching, or language-server semantic resolution.

## Path Resolution and File Discovery

For each requested path:

1. Strip a leading `@`.
2. Resolve against `ctx.cwd` unless already absolute.
3. If the path is a file, scan it if supported.
4. If the path is a directory, recursively discover supported source files.
5. Skip missing paths silently for parity with Dirac's broad path handling, unless all requested paths produce no scannable files.

Directory walking should skip the same broad categories as Dirac's symbol index:

- dependency/build/generated directories: `node_modules`, `dist`, `build`, `out`, `target`, `vendor`, generated folders;
- VCS/config/cache directories: `.git`, `.github`, `.vscode`, `.cache`, `.next`, `.nuxt`, coverage/temp directories;
- common virtualenv/cache directories: `.venv`, `venv`, `env`, `__pycache__`.

Use a conservative max file size of 1 MiB, matching Dirac's symbol index.

## `find_symbol_references` Data Flow

1. Validate `paths` and `symbols` are non-empty arrays.
2. Scan requested paths through the cached scanner.
3. Filter locations by exact symbol name and requested `find_type`.
4. Group hits by file.
5. Read each hit file and reconcile anchors.
6. Merge multiple hits on the same line into one output row with comma-separated symbols.
7. Sort files by display path and lines by line number.
8. Return grouped anchored lines.

If no matches are found, return:

```text
No references or definitions found for symbols: foo, Bar.
```

Adjust wording for `definition` or `reference` find types.

## `rename_symbol` Data Flow

1. Validate `paths`, `existing_symbol`, and `new_symbol` are present.
2. Scan requested paths through the cached scanner.
3. Filter locations where `name === existing_symbol`; include both definitions and references.
4. If no locations are found, return a concise no-op message.
5. Group locations by file.
6. For every affected file, before writing any file:
   - read current content;
   - split using the file's existing line-ending style;
   - sort locations bottom-to-top and right-to-left;
   - verify the current text at each location still equals `existing_symbol`;
   - apply replacements in memory;
   - preserve the file's existing line endings.
7. If any file has a stale/mismatched location or other validation error, throw and write nothing.
8. After all files are prepared, acquire file mutation queues in deterministic path order.
9. Write each affected file once.
10. Reconcile anchors for written files and update/invalidate scanner cache entries for those files.
11. Return a concise success summary:

```text
Successfully renamed symbol 'calculateTotal' to 'calculateGrandTotal' (12 occurrences in 3 files).
```

This is stricter than Dirac's handler, which skips stale locations and applies files one by one. Phase 3 intentionally prevents common partial-write cases by validating and preparing all files before any write.

Like `replace_symbol`, this is not a filesystem transaction: if the OS fails during a later write, earlier writes cannot be rolled back. That limitation is acceptable for Phase 3.

## Cache Semantics

The cache is in-memory and session-local:

- It is created when the extension is loaded.
- It is reused across tool calls in the same process.
- It is invalidated per file by `mtimeMs` and `size`.
- It resets on `/reload`, process restart, or extension reload.
- It is not persisted through `pi.appendEntry`.

This avoids native dependencies, stale persistent index files, and project side effects while still making repeated calls over unchanged files faster.

## Pi Integration

Files expected to change:

- `src/symbols/symbol-scanner.ts` — scanner and cache-aware public API.
- `src/symbols/symbol-cache.ts` — small in-memory cache helper used by the scanner.
- `src/tools/find-symbol-references.ts` — tool registration and output formatting.
- `src/tools/rename-symbol.ts` — tool registration and rename application.
- `src/tools/schemas.ts` — `FindSymbolReferencesSchema` and `RenameSymbolSchema`.
- `src/index.ts` — register both tools with shared anchors and scanner cache.
- `src/mode.ts` — include both tools in all modes.
- `src/prompt.ts` — guidance for symbol lookup and renames.
- `README.md` — usage examples.
- `test/symbol-scanner.test.ts` — scanner/cache tests.
- `test/find-symbol-references.test.ts` — tool behavior tests.
- `test/rename-symbol.test.ts` — tool behavior and safety tests.

Tools should not call `ctx.ui.confirm(...)`. Pi owns tool approval and permission UX.

## Error Handling

Use direct, concise tool errors:

- `Missing required parameter: paths`
- `Missing required parameter: symbols`
- `Missing required parameter: existing_symbol`
- `Missing required parameter: new_symbol`
- `Invalid find_type: <value>`
- `Could not scan any supported files in requested paths.`
- `Stale symbol location for 'foo' in src/file.ts at line 12.`

Unsupported files are skipped during directory scans. A directly requested unsupported file simply contributes no locations.

## Testing Strategy

Automated tests should cover:

### Scanner/cache

- scans TypeScript definitions and references;
- scans JavaScript and Python examples;
- scans at least one example from each currently supported tree-sitter extension when practical, with a smaller representative subset acceptable only if a grammar cannot parse the minimal fixture reliably;
- skips excluded directories and unsupported files;
- uses cached file results when `mtimeMs` and `size` are unchanged;
- invalidates when file metadata changes.

### `find_symbol_references`

- finds definitions only;
- finds references only;
- finds both by default;
- accepts multiple symbols;
- groups output by file and merges same-line hits;
- formats lines with hash anchors;
- returns clear no-match output.

### `rename_symbol`

- renames a function definition and call sites in one file;
- renames across multiple files;
- renames class or method references where query captures expose them;
- preserves CRLF line endings;
- writes each affected file once;
- writes nothing if any prepared file has a stale/mismatched location;
- does not call `ctx.ui.confirm`;
- updates/invalidate cache after writes so subsequent lookup sees the new symbol.

Final verification:

```bash
npm test && npm run typecheck
```

## Out of Scope

- persistent disk index;
- `better-sqlite3` or native dependencies;
- output caps/truncation;
- fuzzy or semantic language-server symbol matching;
- qualified-name/suffix matching for references;
- validating `new_symbol` syntax;
- custom TUI diff rendering;
- diagnostics/lint feedback after rename;
- filesystem-level transactional rollback.
