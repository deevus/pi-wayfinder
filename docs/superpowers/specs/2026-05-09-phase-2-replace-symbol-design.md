# Phase 2 Replace Symbol Design

## Goal

Add a pi `replace_symbol` tool to `pi-dirac-tools` that replaces complete AST symbols by name, matching Dirac's semantics while preserving the adjacent-comment range improvement already implemented in Phase 1.

## Context

Phase 1 added tree-sitter-backed symbol discovery and `ASTAnchorBridge.getSymbolRange(...)`. Phase 2 builds on that foundation to support whole-symbol edits: functions, methods, classes, interfaces, and const/arrow-function definitions supported by the existing tree-sitter queries.

Dirac's `replace_symbol` behavior is the compatibility target:

- canonical input is a batch `replacements` array;
- legacy single replacement input may be tolerated;
- symbols are resolved with exact full-name match or suffix match;
- the first matching symbol in query order wins;
- optional `type` filters matches, with `function` and `method` treated as synonyms;
- replacement text is expected to be complete source code for the symbol;
- hash anchors in replacement text are stripped as a tolerance;
- multiple replacements in a file are rejected if their ranges overlap;
- accepted replacements are applied from bottom to top;
- unsupported languages, parse failures, and missing symbols report clear errors rather than falling back to regex.

## Public API

New tool: `replace_symbol`

Canonical request shape:

```json
{
  "replacements": [
    {
      "path": "src/file.ts",
      "symbol": "ClassName.methodName",
      "text": "complete replacement code",
      "type": "method"
    }
  ]
}
```

Each replacement object contains:

- `path` — relative or absolute source file path. A leading `@` is stripped, matching existing tool conventions.
- `symbol` — dot-separated symbol path or suffix, such as `getFunctions`, `ASTAnchorBridge.getFunctions`, or `Service.run`.
- `text` — complete final code to replace the symbol range. The caller is responsible for correct syntax and indentation.
- `type` — optional symbol kind hint, such as `function`, `method`, `class`, or `interface`.

The tool may also accept legacy top-level `path`, `symbol`, `text`, and `type` parameters by converting them into a single-element `replacements` array. The prompt and schema should prefer the batch form.

## Range Semantics

`replace_symbol` uses `ASTAnchorBridge.getSymbolRange(...)`.

The replaced range includes:

- the full AST definition capture;
- enclosing wrappers such as export/declaration/decorator wrappers already included by the Phase 1 bridge;
- adjacent preceding comments, decorators, or attributes.

Unlike current Dirac, `pi-dirac-tools` keeps the Phase 1 safety improvement: detached comments separated by a blank line are not included. This avoids replacing unrelated comments while preserving normal JSDoc/decorator behavior.

## Matching Semantics

For each replacement:

1. Normalize requested symbol by replacing `::` with `.`.
2. Traverse query matches in tree-sitter query order.
3. Derive each candidate's full name using the Phase 1 parent-definition walk.
4. Match if either:
   - candidate full name equals requested symbol, or
   - candidate full name ends with `.` + requested symbol.
5. Apply `type` filtering if provided.
6. Return the first compatible match.

Ambiguous suffixes are not rejected. This matches Dirac's current behavior.

## Edit Application Semantics

For each file batch:

1. Read current file content.
2. Resolve every replacement symbol before mutating the file.
3. If any symbol is missing, return an error and write nothing.
4. Sort resolved ranges by start index.
5. If any ranges overlap, return an error and write nothing.
6. Strip hash anchors from each replacement text.
7. Apply replacements from bottom to top.
8. Preserve the file's existing EOL style where practical by normalizing replacement newlines to the file's dominant EOL.
9. Write the final content once.

The tool does not require a file hash. Symbols are resolved against the current file content at execution time. Existing anchors for replaced symbols become stale after a successful replacement.

## Output Semantics

On success, return a concise summary per file:

```text
Successfully replaced symbols 'Service.run', 'helper' in src/sample.ts. Any existing hash anchors for these symbols are now stale.
```

On error, return a clear tool error message such as:

- `Missing required parameter: replacements`
- `Symbol 'Service.run' of type 'method' not found in src/sample.ts.`
- `Overlapping replacements detected for symbols 'Service' and 'Service.run' in src/sample.ts.`
- `Error replacing symbols: <message>`

The pi extension does not need to reproduce Dirac's VS Code approval UI, diagnostics capture, or diff-view flow. Tests should validate file contents and error messages directly.

## Integration

Files expected to change:

- `src/tools/replace-symbol.ts` — new tool implementation.
- `src/tools/schemas.ts` — schema for `replace_symbol`.
- `src/index.ts` — tool registration.
- `src/prompt.ts` — prompt guidance explaining when and how to use `replace_symbol`.
- `src/mode.ts` — include `replace_symbol` in preferred/replacement-mode guidance if needed.
- `test/replace-symbol.test.ts` — behavior tests.
- `README.md` — short documentation section.

No new runtime dependencies are expected.

## Testing Strategy

Automated tests should cover:

- replacing a top-level TypeScript function;
- replacing a class method by suffix name;
- replacing a JS class method;
- replacing a Python function or method if supported by current queries;
- optional `type` filtering;
- first suffix match behavior for ambiguous names;
- missing-symbol error;
- unsupported-language or parse-failure error;
- overlapping replacement rejection;
- batched replacements in one file and multiple files;
- hash-anchor stripping in replacement text;
- CRLF preservation;
- adjacent comment/decorator inclusion;
- detached comment exclusion.

Final verification:

```bash
npm test && npm run typecheck
```

## Out of Scope

- `find_symbol_references`
- `rename_symbol`
- persistent symbol indexes
- ambiguity rejection
- mandatory file-hash checks
- formatting/lint diagnostics integration
- custom TUI diff rendering
