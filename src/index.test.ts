import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import diracToolsExtension from "./index.js";

type UiContext = {
  ui: {
    setStatus: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
  };
};

type SessionStartHandler = (event: unknown, ctx: UiContext) => Promise<void> | void;
type BeforeAgentStartHandler = (event: { systemPrompt: string }) => Promise<{ systemPrompt: string }> | { systemPrompt: string };
type CommandHandler = (args: string, ctx: UiContext) => Promise<void> | void;

function createMockPi(initialTools: string[]) {
  let activeTools = [...initialTools];
  let sessionStartHandler: SessionStartHandler | undefined;
  let beforeAgentStartHandler: BeforeAgentStartHandler | undefined;
  const commands = new Map<string, { handler: CommandHandler }>();
  const flags = new Map<string, string>([
    ["dirac-tools-mode", "preferred"],
    ["dirac-override-builtins", "none"]
  ]);

  const pi = {
    registerTool: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn((name: string) => flags.get(name)),
    getActiveTools: vi.fn(() => [...activeTools]),
    setActiveTools: vi.fn((tools: string[]) => {
      activeTools = [...tools];
    }),
    on: vi.fn((event: string, handler: SessionStartHandler | BeforeAgentStartHandler) => {
      if (event === "session_start") sessionStartHandler = handler as SessionStartHandler;
      if (event === "before_agent_start") beforeAgentStartHandler = handler as BeforeAgentStartHandler;
    }),
    registerCommand: vi.fn((name: string, command: { handler: CommandHandler }) => {
      commands.set(name, command);
    })
  };

  return {
    pi,
    commands,
    get sessionStartHandler() {
      return sessionStartHandler;
    },
    get beforeAgentStartHandler() {
      return beforeAgentStartHandler;
    },
    get activeTools() {
      return activeTools;
    }
  };
}

function createContext(): UiContext {
  return {
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn()
    }
  };
}

const expectedDiracTools = [
  "read_file",
  "edit_file",
  "get_file_skeleton",
  "get_function",
  "replace_symbol",
  "find_symbol_references",
  "rename_symbol"
];

describe("diracToolsExtension", () => {
  it("switches modes from the session-start active tool baseline", async () => {
    const mock = createMockPi(["read", "edit", "custom"]);
    const ctx = createContext();

    diracToolsExtension(mock.pi as unknown as ExtensionAPI);

    expect(mock.sessionStartHandler).toBeDefined();
    await mock.sessionStartHandler?.({}, ctx);
    expect(mock.activeTools).toEqual(["read", "edit", "custom", ...expectedDiracTools]);

    const command = mock.commands.get("dirac-tools");
    expect(command).toBeDefined();

    await command?.handler("replacement", ctx);
    expect(mock.activeTools).toEqual(["custom", ...expectedDiracTools, "write", "bash", "grep", "find", "ls"]);

    await command?.handler("additive", ctx);
    expect(mock.activeTools).toEqual(["read", "edit", "custom", ...expectedDiracTools]);
  });

  it("uses command-selected mode for injected prompt guidance", async () => {
    const mock = createMockPi(["read", "edit"]);
    const ctx = createContext();

    diracToolsExtension(mock.pi as unknown as ExtensionAPI);

    expect(mock.beforeAgentStartHandler).toBeDefined();
    const command = mock.commands.get("dirac-tools");
    expect(command).toBeDefined();

    await command?.handler("replacement", ctx);
    const result = await mock.beforeAgentStartHandler?.({ systemPrompt: "base" });

    expect(result?.systemPrompt).toContain("Replacement mode is active.");
    expect(result?.systemPrompt).not.toContain("Preferred mode is active.");
    expect(result?.systemPrompt).toContain("Use replace_symbol for whole-symbol replacements");
  });

  it("registers replace_symbol with the extension tools", () => {
    const mock = createMockPi(["read", "edit"]);

    diracToolsExtension(mock.pi as unknown as ExtensionAPI);

    const registeredNames = mock.pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(registeredNames).toEqual(expectedDiracTools);
  });
});
