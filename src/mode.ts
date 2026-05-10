export type WayfinderToolMode = "additive" | "preferred" | "replacement";
export type WayfinderOverrideMode = "none" | "read" | "read_edit";

export const DEFAULT_WAYFINDER_TOOL_MODE: WayfinderToolMode = "preferred";
export const DEFAULT_WAYFINDER_OVERRIDE_MODE: WayfinderOverrideMode = "none";

export function parseToolMode(value: unknown): WayfinderToolMode {
  if (value === "additive" || value === "preferred" || value === "replacement") return value;
  return DEFAULT_WAYFINDER_TOOL_MODE;
}

export function parseOverrideMode(value: unknown): WayfinderOverrideMode {
  if (value === "none" || value === "read" || value === "read_edit") return value;
  return DEFAULT_WAYFINDER_OVERRIDE_MODE;
}

export function activeToolsForMode(mode: WayfinderToolMode, currentTools: string[]): string[] {
  const wayfinderTools = ["read_file", "edit_file", "get_file_skeleton", "get_function", "replace_symbol", "find_symbol_references", "rename_symbol"];
  if (mode !== "replacement") return Array.from(new Set([...currentTools, ...wayfinderTools]));
  const keep = currentTools.filter((name) => name !== "edit");
  return Array.from(new Set([...keep, ...wayfinderTools, "read", "write", "bash", "grep", "find", "ls"]));
}
