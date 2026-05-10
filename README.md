# pi-dirac-tools

Dirac-style hash-anchored and AST-aware editing tools for pi.

## Modes

- `additive`: add Dirac tools without changing pi built-ins.
- `preferred`: default; add Dirac tools and guide the model to prefer them for source edits.
- `replacement`: deactivate pi `read` and `edit` from the active toolset and use `read_file` / `edit_file` instead.

## Built-in replacement

`replacement` mode is a soft replacement: it removes pi `read` and `edit` from the active toolset and activates Dirac `read_file` and `edit_file`. It does not override pi's built-in implementations. This is the safest idiomatic pi behavior.

A future explicit `--dirac-override-builtins read_edit` mode can register tools named `read` and `edit`, but that is intentionally separate because overriding built-ins can surprise existing workflows.

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

Slash-command mode changes are persisted in the current pi session and restored on reload/resume. An explicit `--dirac-tools-mode ...` flag takes precedence over the persisted session mode.

## Reading files

`read_file` accepts global `start_line` / `end_line` for applying the same line range to every requested file. For mixed reads where only one file needs a range, put the range on that path instead:

```json
{ "paths": ["PROJECTS/ROLLER/3d.h", "build.zig:150-230"] }
```


## Smoke tests

```bash
pi -e . --dirac-tools-mode additive -p "Use read_file on README.md and summarize the first 20 lines."
pi -e . --dirac-tools-mode replacement -p "Use read_file on README.md and report whether Dirac mentions hash-anchored edits."
```

Verification note: On 2026-05-08 during Task 7, package checks plus additive and replacement smoke tests were verified successfully.

## Tree-sitter AST tools

`get_file_skeleton` and `get_function` use Dirac-style tree-sitter parsing for supported source files. Supported extensions include `ts`, `tsx`, `js`, `jsx`, `py`, `rs`, `go`, `c`, `h`, `cpp`, `hpp`, `cs`, `rb`, `java`, `php`, `swift`, and `kt`.

For unsupported languages or parser load failures, the tools fall back to the conservative regex MVP for common JavaScript, TypeScript, and Python top-level definitions.

## Symbol replacement

`replace_symbol` replaces complete AST symbols by name. Use it when replacing an entire function, method, class, interface, or exported const/arrow function.

```json
{
  "replacements": [
    {
      "path": "src/sample.ts",
      "symbol": "Service.run",
      "type": "method",
      "text": "  run() {\n    return 2;\n  }"
    }
  ]
}
```

The tool resolves symbols with tree-sitter, rejects overlapping replacements in the same file, applies accepted replacements from bottom to top, strips hash anchors from replacement text, and preserves the file's existing line-ending style where practical.

The `replacements` array is required. Unsupported languages, parser failures, and missing symbols are reported as errors; `replace_symbol` does not fall back to regex matching.

## Finding symbol references

`find_symbol_references` finds exact tree-sitter definitions and references for one or more symbols across files or directories.

```json
{
  "paths": ["src/", "test/"],
  "symbols": ["calculateTotal", "UserAccount"],
  "find_type": "both"
}
```

`find_type` can be `definition`, `reference`, or `both` (default). Results are grouped by file and include stable hash anchors for each matching line.

## Renaming symbols

`rename_symbol` renames all exact tree-sitter definitions and references of one symbol inside the requested files or directories.

```json
{
  "paths": ["src/", "test/"],
  "existing_symbol": "calculateTotal",
  "new_symbol": "calculateGrandTotal"
}
```

The tool uses an in-memory session cache for scanned files, invalidated by file `mtime` and size. It does not create a persistent symbol index. Before writing, it prepares all affected files and verifies every indexed location still matches the existing symbol; if validation fails, no file is written.

## Interactive rendering

In pi's interactive TUI, Dirac tools render with pi-native readable output:

- read-like tools hide `DiracX│` anchor prefixes visually while preserving anchors in model-facing tool content;
- `edit_file`, `replace_symbol`, and `rename_symbol` render unified diffs using pi's diff renderer;
- print/JSON/API outputs keep the same anchored text contract used by the agent.

This means humans see clean code and diffs, while the agent still receives stable anchors for follow-up edits.
