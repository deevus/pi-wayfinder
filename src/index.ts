import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AnchorStateManager } from "./anchors/AnchorStateManager.js";
import { activeToolsForMode, parseOverrideMode, parseToolMode } from "./mode.js";
import { getDiracPromptGuidance } from "./prompt.js";
import { SymbolCache } from "./symbols/symbol-cache.js";
import { SymbolScanner } from "./symbols/symbol-scanner.js";
import { registerEditFileTool } from "./tools/edit-file.js";
import { registerFindSymbolReferencesTool } from "./tools/find-symbol-references.js";
import { registerGetFileSkeletonTool } from "./tools/get-file-skeleton.js";
import { registerGetFunctionTool } from "./tools/get-function.js";
import { registerReadFileTool } from "./tools/read-file.js";
import { registerRenameSymbolTool } from "./tools/rename-symbol.js";
import { registerReplaceSymbolTool } from "./tools/replace-symbol.js";

export default function diracToolsExtension(pi: ExtensionAPI): void {
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

  pi.registerFlag("dirac-tools-mode", {
    description: "Dirac tools mode: additive, preferred, or replacement",
    type: "string",
    default: "preferred"
  });

  pi.registerFlag("dirac-override-builtins", {
    description: "Hard override pi built-ins: none, read, or read_edit",
    type: "string",
    default: "none"
  });

  let currentMode = parseToolMode(pi.getFlag("dirac-tools-mode"));

  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${getDiracPromptGuidance(currentMode)}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    symbolCache.clear();
    baselineActiveTools = [...pi.getActiveTools()];
    currentMode = parseToolMode(pi.getFlag("dirac-tools-mode"));
    const active = activeToolsForMode(currentMode, baselineActiveTools);
    pi.setActiveTools(active);
    ctx.ui.setStatus("dirac-tools", `dirac:${currentMode}`);
  });

  pi.registerCommand("dirac-tools", {
    description: "Switch Dirac tool mode: additive, preferred, replacement",
    handler: async (args, ctx) => {
      const mode = parseToolMode(args.trim());
      currentMode = mode;
      pi.setActiveTools(activeToolsForMode(mode, getBaselineActiveTools()));
      ctx.ui.setStatus("dirac-tools", `dirac:${mode}`);
      ctx.ui.notify(`Dirac tools mode set to ${mode}`, "info");
    }
  });

  const overrideMode = parseOverrideMode(pi.getFlag("dirac-override-builtins"));
  void overrideMode;
}
