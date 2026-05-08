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

## Smoke tests

```bash
pi -e . --dirac-tools-mode additive -p "Use read_file on README.md and summarize the first 20 lines."
pi -e . --dirac-tools-mode replacement -p "Use read_file on README.md and report whether Dirac mentions hash-anchored edits."
```

Verification note: On 2026-05-08 during Task 7, package checks plus additive and replacement smoke tests were verified successfully.

## Tree-sitter AST tools

`get_file_skeleton` and `get_function` use Dirac-style tree-sitter parsing for supported source files. Supported extensions include `ts`, `tsx`, `js`, `jsx`, `py`, `rs`, `go`, `c`, `h`, `cpp`, `hpp`, `cs`, `rb`, `java`, `php`, `swift`, and `kt`.

For unsupported languages or parser load failures, the tools fall back to the conservative regex MVP for common JavaScript, TypeScript, and Python top-level definitions.
