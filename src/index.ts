import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AnchorStateManager } from "./anchors/AnchorStateManager.js";
import { activeToolsForMode, parseOverrideMode, parseToolMode } from "./mode.js";
import { getDiracPromptGuidance } from "./prompt.js";
import { registerEditFileTool } from "./tools/edit-file.js";
import { registerReadFileTool } from "./tools/read-file.js";

export default function diracToolsExtension(pi: ExtensionAPI): void {
  const anchors = new AnchorStateManager();
  registerReadFileTool(pi, anchors);
  registerEditFileTool(pi, anchors);

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

  pi.on("before_agent_start", async (event) => {
    const mode = parseToolMode(pi.getFlag("dirac-tools-mode"));
    return { systemPrompt: `${event.systemPrompt}\n\n${getDiracPromptGuidance(mode)}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    baselineActiveTools = [...pi.getActiveTools()];
    const mode = parseToolMode(pi.getFlag("dirac-tools-mode"));
    const active = activeToolsForMode(mode, baselineActiveTools);
    pi.setActiveTools(active);
    ctx.ui.setStatus("dirac-tools", `dirac:${mode}`);
  });

  pi.registerCommand("dirac-tools", {
    description: "Switch Dirac tool mode: additive, preferred, replacement",
    handler: async (args, ctx) => {
      const mode = parseToolMode(args.trim());
      pi.setActiveTools(activeToolsForMode(mode, getBaselineActiveTools()));
      ctx.ui.setStatus("dirac-tools", `dirac:${mode}`);
      ctx.ui.notify(`Dirac tools mode set to ${mode}`, "info");
    }
  });

  const overrideMode = parseOverrideMode(pi.getFlag("dirac-override-builtins"));
  void overrideMode;
}
