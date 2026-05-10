# pi-wayfinder

Structure-aware code navigation and anchor-stable editing tools for pi agents.

Wayfinder helps agents keep code context focused with compact file skeletons, targeted function reads, stable anchored edits, whole-symbol replacement, and exact symbol search/rename.

## Why context stays focused

Wayfinder gives agents precise source-code tools instead of forcing broad file reads and brittle line-number edits:

- `get_file_skeleton` returns a compact outline before reading full source.
- `get_function` reads only the definitions needed for the task.
- `read_file` supports stable anchors and narrow line ranges.
- `edit_file` batches precise edits across one or more files by anchor.
- `replace_symbol` rewrites complete functions, methods, classes, interfaces, or exported const/arrow functions.
- `find_symbol_references` and `rename_symbol` avoid manual grep-and-edit loops.

Anchors add a small prefix to returned source lines, but they are intended to prevent repeated reads, failed edits, and correction turns.

## Install

```bash
pi install npm:@deevus/pi-wayfinder
```

For local development:

```bash
pi -e . --wayfinder-mode preferred
```


## Modes

- `additive`: add Wayfinder tools without changing pi built-ins.
- `preferred`: default; add Wayfinder tools and guide the model to prefer them for source-code reads and edits.
- `replacement`: deactivate pi `edit` from the active toolset and use Wayfinder source-editing tools instead; keep built-in `read` for images, PDFs, and binary/non-source assets.

## Built-in replacement

`replacement` mode is a soft source-editing replacement: it removes pi `edit` from the active toolset and activates Wayfinder `read_file`, `edit_file`, and AST-aware tools. It intentionally keeps pi `read` active for images, PDFs, and binary/non-source assets. It does not override pi's built-in implementations. This is the safest idiomatic pi behavior.

A future explicit `--wayfinder-override-builtins read_edit` mode can register tools named `read` and `edit`, but that is intentionally separate because overriding built-ins can surprise existing workflows.

Run from a local checkout:

```bash
pi -e . --wayfinder-mode preferred
pi -e . --wayfinder-mode replacement
```

Inside pi:

```txt
/wayfinder additive
/wayfinder preferred
/wayfinder replacement
```

Slash-command mode changes are persisted in the current pi session and restored on reload/resume. An explicit `--wayfinder-mode ...` flag takes precedence over the persisted session mode.

## Reading files

`read_file` accepts global `start_line` / `end_line` for applying the same line range to every requested file. For mixed reads where only one file needs a range, put the range on that path instead:

```json
{ "paths": ["PROJECTS/ROLLER/3d.h", "build.zig:150-230"] }
```

## Smoke tests

```bash
pi -e . --wayfinder-mode additive -p "Use read_file on README.md and summarize the first 20 lines."
pi -e . --wayfinder-mode replacement -p "Use read_file on README.md and report whether Wayfinder mentions anchor-stable editing."
```

## Tree-sitter AST tools

`get_file_skeleton` and `get_function` use tree-sitter parsing for supported source files. Supported extensions include `bash`, `sh`, `zsh`, `ts`, `tsx`, `js`, `jsx`, `py`, `rs`, `go`, `c`, `h`, `cpp`, `cc`, `cxx`, `hpp`, `hh`, `hxx`, `cs`, `css`, `el`, `elisp`, `ex`, `exs`, `html`, `htm`, `rb`, `java`, `json`, `php`, `swift`, `kt`, `kts`, `lua`, `m`, `mm`, `ml`, `mli`, `res`, `resi`, `scala`, `sc`, `sol`, `rdl`, `tla`, `toml`, `vue`, and `zig`.

For unsupported languages or parser load failures, the tools fall back to the conservative regex MVP for common JavaScript, TypeScript, and Python top-level definitions.

Some bundled tree-sitter WASMs are intentionally not enabled yet because they are incompatible with the current `web-tree-sitter` runtime or fail to parse reliably in Node: Dart, Elm, QL, and YAML.

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

In pi's interactive TUI, Wayfinder tools render with pi-native readable output:

- read-like tools hide `WayX│` anchor prefixes visually while preserving anchors in model-facing tool content;
- `edit_file`, `replace_symbol`, and `rename_symbol` render unified diffs using pi's diff renderer;
- print/JSON/API outputs keep the same anchored text contract used by the agent.

This means humans see clean code and diffs, while the agent still receives stable anchors for follow-up edits.
