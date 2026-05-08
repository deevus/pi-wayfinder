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
