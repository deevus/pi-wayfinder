export type DiracToolMode = "additive" | "preferred" | "replacement";
export type DiracOverrideMode = "none" | "read" | "read_edit";

export const DEFAULT_DIRAC_TOOL_MODE: DiracToolMode = "preferred";
export const DEFAULT_DIRAC_OVERRIDE_MODE: DiracOverrideMode = "none";

export function parseToolMode(value: unknown): DiracToolMode {
  if (value === "additive" || value === "preferred" || value === "replacement") return value;
  return DEFAULT_DIRAC_TOOL_MODE;
}

export function parseOverrideMode(value: unknown): DiracOverrideMode {
  if (value === "none" || value === "read" || value === "read_edit") return value;
  return DEFAULT_DIRAC_OVERRIDE_MODE;
}

export function activeToolsForMode(mode: DiracToolMode, currentTools: string[]): string[] {
  const diracTools = ["read_file", "edit_file", "get_file_skeleton", "get_function"];
  if (mode !== "replacement") return Array.from(new Set([...currentTools, ...diracTools]));
  const keep = currentTools.filter((name) => name !== "read" && name !== "edit");
  return Array.from(new Set([...keep, ...diracTools, "write", "bash", "grep", "find", "ls"]));
}
