import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { activeToolsForMode, parseOverrideMode, parseToolMode } from "./mode.js";

export default function diracToolsExtension(pi: ExtensionAPI): void {
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
