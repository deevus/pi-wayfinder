# Phase 4 Pi-native UX Renderers and Diffs Design

## Goal

Improve the human UX of `pi-dirac-tools` without weakening the agent-facing editing contract.

Current tool outputs are technically useful but visually noisy:

- reads and symbol lookups show raw `DiracX│` anchor prefixes in the TUI;
- `edit_file` does not display a pi-style diff;
- `replace_symbol` and `rename_symbol` only report concise success summaries;
- `rename_symbol` does not show what changed.

Phase 4 will make Dirac tools feel like first-class pi tools by reusing pi's exported rendering plumbing.

## Non-goals

- Do not remove anchors from model-facing tool content.
- Do not change existing public tool input schemas.
- Do not introduce new user approval prompts; pi owns permission/approval UX.
- Do not implement a separate UI framework.
- Do not make print/JSON/API output depend on TUI rendering.

## Core Principle

Treat tool `content` as the agent contract and `renderCall` / `renderResult` as the human UX layer.

The agent must still see raw hash anchors like `DiracA│...` so it can call `edit_file` reliably. Humans will see clean, pi-style output in the interactive TUI.

## Approach

Use renderer-only polish by default:

1. Keep model-facing text outputs anchored.
2. Add pi-style `renderCall` and `renderResult` functions to Dirac tools.
3. Add diff details to mutating tool results.
4. Reuse pi exports such as `Text`, `Container`, `Spacer`, `renderDiff`, `highlightCode`, and `getLanguageFromPath` where available.
5. Use the existing `diff` dependency in this package to generate unified diff strings because pi's internal `generateDiffString` helper is not exported.

Rejected alternatives:

- Moving anchors into `details` only: cleaner output, but too risky for agent reliability.
- Adding optional `format: "pretty"`: flexible but burdens the agent and creates footguns.
- Fully custom renderer styling: unnecessary and likely to drift from pi's built-in UX.

## Read-like Tool Rendering

Applies to:

- `read_file`
- `get_function`
- `get_file_skeleton`
- `find_symbol_references`

Behavior:

- Tool content remains unchanged and anchored for the agent.
- TUI renderers strip anchor prefixes visually.
- Collapsed render shows a concise pi-style call header and a small preview, similar to built-in `read`.
- Expanded render shows the full result, still visually stripped of anchor prefixes.
- Where practical, syntax highlighting uses pi's `getLanguageFromPath` and `highlightCode`.
- File headers and metadata are human-readable. Collapsed views omit raw `[File Hash: ...]`; expanded views may include it only as muted metadata.

Anchor handling:

- Lines matching `^[A-Z][a-zA-Z]*│` are displayed without the prefix.
- Lines with symbol prefixes such as `  (symbol) DiracA│...` keep the `(symbol)` marker but strip `DiracA│` from the code portion.
- The renderer must not mutate returned content.

## Mutating Tool Rendering

Applies to:

- `edit_file`
- `replace_symbol`
- `rename_symbol`

Behavior:

- Tool execution computes unified diffs for every changed file.
- Tool results include diff details suitable for rendering.
- TUI renderers use pi's exported `renderDiff(...)` for visual output.
- Success text remains concise for the agent.

Details shape:

For single-file changes, include:

```ts
{
  diff: string;
  firstChangedLine?: number;
}
```

For multi-file changes, include:

```ts
{
  diffs: Array<{
    path: string;
    diff: string;
    firstChangedLine?: number;
  }>;
  diff: string; // concatenated unified diff for renderers and compatibility
}
```

The exact existing fields (`paths`, `symbols`, etc.) remain where already present.

Rendering:

- `edit_file` resembles built-in `edit`: call header plus diff body.
- `replace_symbol` shows a diff for each affected file.
- `rename_symbol` shows a diff for each affected file and concise summary counts.
- Collapsed mode shows summary counts; expanded mode shows full diff.

## Diff Generation

Add a shared helper under `src/rendering/diff-output.ts`:

- `createUnifiedDiff(path, before, after): { diff: string; firstChangedLine?: number }`
- `combineDiffs(diffs): string`

Use the existing `diff` package. The output must be compatible with pi's `renderDiff(...)`.

Line-ending behavior:

- Diff generation may normalize to LF for display.
- File writes must preserve existing behavior and line endings.

## Shared Rendering Helpers

Add a small rendering/helper module, `src/rendering/pi-renderers.ts`, with functions such as:

- `stripAnchorPrefixesForDisplay(text: string): string`
- `renderCodeLikeResult(args, result, options, theme, context): Text`
- `renderDiffResult(result, options, theme, context): Container | Text`
- `shortenPath` equivalent if pi's internal helper is not exported.

Prefer importing from pi exports when available. Keep fallbacks small and local.

## Tool-specific Notes

### `read_file`

- Keep current anchored content.
- Add `details` fields for renderers: paths, file hashes, selected ranges, and truncation metadata where available.
- Render call with path and line range, similar to `read path:1-20`.
- Render result as clean code without anchors.

### `get_file_skeleton`

- Render clean skeleton lines without anchors.
- Preserve tree markers such as `|----`.

### `get_function`

- Render clean function body without anchors.
- Preserve function header labels, but keep display compact.

### `find_symbol_references`

- Render grouped file results with symbols and clean code lines.
- Do not show raw anchors in the human renderer.
- Show line numbers in the human renderer using scanner `startLine` metadata.

### `edit_file`

- Compute diff after applying anchored edits and before writing or immediately after preparation.
- Include diff details in result.
- Render via `renderDiff`.

### `replace_symbol`

- Compute diff for each file after applying replacements.
- Include diff details in result.
- Render via `renderDiff`.

### `rename_symbol`

- Compute diff for each file during prepare-before-write.
- Include diff details in result.
- Render via `renderDiff`.

## Compatibility

- Existing tests for content continue passing unless they assert exact details shape; update those tests only to add richer details.
- Existing tool consumers still receive anchored text in `content`.
- Print mode remains readable enough because content is unchanged; full TUI UX improvements are interactive-only.
- New renderer imports rely on pi peer dependency exports, not deep private paths.

## Testing

Add tests for:

1. Anchor stripping helpers:
   - plain `DiracA│code` lines;
   - indented symbol reference lines like `  (foo) DiracB│foo()`;
   - non-anchor lines unchanged.
2. Diff helper:
   - produces unified diff with additions/removals;
   - returns first changed line when possible;
   - combines multi-file diffs.
3. Mutating tools:
   - `edit_file` result includes `details.diff`;
   - `replace_symbol` result includes diff details;
   - `rename_symbol` result includes diff details across multiple files.
4. Renderer smoke tests:
   - `renderResult` returns a pi TUI component/text without throwing;
   - clean rendered text does not contain `DiracA│` prefixes for read-like tools.

## Decisions

- Anchors remain visible to the agent.
- Anchors are hidden only in human-facing TUI renderers.
- Use pi exported rendering plumbing rather than deep internal imports or custom styling.
