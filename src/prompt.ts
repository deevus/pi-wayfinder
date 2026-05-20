import type { WayfinderToolMode } from "./mode.js";

export function getWayfinderPromptGuidance(mode: WayfinderToolMode): string {
  const base = `
## Wayfinder source editing

When exploring existing source files, prefer this workflow:
1. Start with get_file_skeleton to map functions, classes, methods, and exports without reading the whole file.
2. Use get_function next for the specific definitions you need to understand or change.
3. Use read_file only for narrow line ranges, non-symbol context, small/config files, or when skeleton/function output is insufficient.
4. Use replace_symbol for whole-symbol replacements such as functions, methods, classes, interfaces, or exported const/arrow functions.
5. Use edit_file for targeted source edits that are smaller than a complete symbol.
6. Batch non-overlapping edits across files in one edit_file or replace_symbol call.
7. Use pi built-in edit/write only when anchors or AST symbol replacement are unnecessary, such as small config files or brand-new files.
8. Use pi built-in read for non-source assets such as images, PDFs, or binary files; use read_file for source/text files where anchors are useful.
9. For mixed read_file calls where only one file needs a line range, put the range on that path (for example, paths: ["src/a.ts", "build.zig:150-230"]) instead of using global start_line/end_line.

Anchor rules:
- Anchors have the form AnchorWord│exact line content.
- Anchor values must include the full anchored line, e.g. AnchorWord│exact line content.
- For single-line replace edits, end_anchor is optional and defaults to anchor.
- For replace_range or multi-line replacements, include end_anchor as the full anchored line at the end of the range.
- edit_file text must contain raw final code without anchors.

replace_symbol rules:
- replace_symbol uses a batch-only replacements array.
- Each replacement text must be complete raw code for that symbol, including export keywords, decorators, and adjacent documentation comments that should remain.
- Existing anchors for replaced symbols become stale after replace_symbol succeeds.

Symbol navigation rules:
- Use find_symbol_references to inspect exact AST definitions/references before broad rename work.
- Use rename_symbol for exact symbol renames across files/directories; it renames definitions and references together.
`;

  if (mode === "replacement") {
    return `${base}\nReplacement mode is active. Treat get_file_skeleton and get_function as the primary source-code exploration tools, then use read_file, edit_file, and replace_symbol when their narrower roles apply. Built-in read remains available for images, PDFs, and binary/non-source assets.`;
  }
  if (mode === "additive") {
    return `${base}\nAdditive mode is active. Wayfinder tools are available when precision matters; use get_file_skeleton before broad source reads.`;
  }
  return `${base}\nPreferred mode is active. Prefer get_file_skeleton for first-pass source exploration, then get_function for targeted implementation reads.`;
}
