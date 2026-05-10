import type { WayfinderToolMode } from "./mode.js";

export function getWayfinderPromptGuidance(mode: WayfinderToolMode): string {
  const base = `
## Wayfinder source editing

When editing existing source files, prefer this workflow:
1. Use read_file, get_file_skeleton, or get_function to understand the code and obtain stable anchors.
2. Use replace_symbol for whole-symbol replacements such as functions, methods, classes, interfaces, or exported const/arrow functions.
3. Use edit_file for targeted source edits that are smaller than a complete symbol.
4. Batch non-overlapping edits across files in one edit_file or replace_symbol call.
5. Use pi built-in edit/write only when anchors or AST symbol replacement are unnecessary, such as small config files or brand-new files.
6. Use pi built-in read for non-source assets such as images, PDFs, or binary files; use read_file for source/text files where anchors are useful.
7. For mixed read_file calls where only one file needs a line range, put the range on that path (for example, paths: ["src/a.ts", "build.zig:150-230"]) instead of using global start_line/end_line.

Anchor rules:
- Anchors have the form AnchorWord│exact line content.
- Always include the full anchored line as anchor/end_anchor.
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
    return `${base}\nReplacement mode is active. Treat read_file, edit_file, and replace_symbol as the primary source-code read/edit tools. Built-in read remains available for images, PDFs, and binary/non-source assets.`;
  }
  if (mode === "additive") {
    return `${base}\nAdditive mode is active. Wayfinder tools are available when precision matters.`;
  }
  return `${base}\nPreferred mode is active. Prefer Wayfinder tools for source-code reads and edits.`;
}
