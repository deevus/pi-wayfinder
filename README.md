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
