import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { WayfinderToolMode } from "./mode.js";
import { AnchorStateManager } from "./anchors/AnchorStateManager.js";
import { activeToolsForMode, parseOverrideMode, parseToolMode } from "./mode.js";
import { getWayfinderPromptGuidance } from "./prompt.js";
import { SymbolCache } from "./symbols/symbol-cache.js";
import { SymbolScanner } from "./symbols/symbol-scanner.js";
import { registerEditFileTool } from "./tools/edit-file.js";
import { registerFindSymbolReferencesTool } from "./tools/find-symbol-references.js";
import { registerGetFileSkeletonTool } from "./tools/get-file-skeleton.js";
import { registerGetFunctionTool } from "./tools/get-function.js";
import { registerReadFileTool } from "./tools/read-file.js";
import { registerRenameSymbolTool } from "./tools/rename-symbol.js";
import { registerReplaceSymbolTool } from "./tools/replace-symbol.js";

const MODE_STATE_CUSTOM_TYPE = "pi-wayfinder:mode";

interface PersistedModeState {
  mode?: unknown;
}

interface SessionEntryLike {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
}

function isWayfinderToolMode(value: unknown): value is WayfinderToolMode {
  return value === "additive" || value === "preferred" || value === "replacement";
}

function restorePersistedMode(ctx: { sessionManager?: { getEntries?: () => SessionEntryLike[] } }): WayfinderToolMode | undefined {
  const entries = ctx.sessionManager?.getEntries?.() || [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== MODE_STATE_CUSTOM_TYPE) continue;
    const data = entry.data as PersistedModeState | undefined;
    const mode = data?.mode;
    if (isWayfinderToolMode(mode)) return mode;
  }
  return undefined;
}

export default function wayfinderExtension(pi: ExtensionAPI): void {
  const anchors = new AnchorStateManager();
  const symbolCache = new SymbolCache();
  const symbolScanner = new SymbolScanner(symbolCache);
  registerReadFileTool(pi, anchors);
  registerEditFileTool(pi, anchors);
  registerGetFileSkeletonTool(pi, anchors);
  registerGetFunctionTool(pi, anchors);
  registerReplaceSymbolTool(pi, anchors);

  registerFindSymbolReferencesTool(pi, anchors, symbolScanner);
  registerRenameSymbolTool(pi, anchors, symbolScanner);

  let baselineActiveTools: string[] | undefined;

  const getBaselineActiveTools = (): string[] => {
    if (baselineActiveTools === undefined) {
      baselineActiveTools = [...pi.getActiveTools()];
    }
    return baselineActiveTools;
  };

  pi.registerFlag("wayfinder-mode", {
    description: "Wayfinder mode: additive, preferred, or replacement",
    type: "string"
  });

  pi.registerFlag("wayfinder-override-builtins", {
    description: "Hard override pi built-ins: none, read, or read_edit",
    type: "string",
    default: "none"
  });

  let currentMode = parseToolMode(pi.getFlag("wayfinder-mode"));

  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${getWayfinderPromptGuidance(currentMode)}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    symbolCache.clear();
    baselineActiveTools = [...pi.getActiveTools()];
    const flagMode = pi.getFlag("wayfinder-mode");
    currentMode = flagMode === undefined ? (restorePersistedMode(ctx) ?? parseToolMode(flagMode)) : parseToolMode(flagMode);
    const active = activeToolsForMode(currentMode, baselineActiveTools);
    pi.setActiveTools(active);
    ctx.ui.setStatus("wayfinder", `wayfinder:${currentMode}`);
  });

  pi.registerCommand("wayfinder", {
    description: "Switch Wayfinder mode: additive, preferred, replacement",
    handler: async (args, ctx) => {
      const mode = parseToolMode(args.trim());
      currentMode = mode;
      pi.appendEntry(MODE_STATE_CUSTOM_TYPE, { mode });
      pi.setActiveTools(activeToolsForMode(mode, getBaselineActiveTools()));
      ctx.ui.setStatus("wayfinder", `wayfinder:${mode}`);
      ctx.ui.notify(`Wayfinder mode set to ${mode}`, "info");
    }
  });

  const overrideMode = parseOverrideMode(pi.getFlag("wayfinder-override-builtins"));
  void overrideMode;
}
