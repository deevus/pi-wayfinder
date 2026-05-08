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
type CommandHandler = (args: string, ctx: UiContext) => Promise<void> | void;

function createMockPi(initialTools: string[]) {
  let activeTools = [...initialTools];
  let sessionStartHandler: SessionStartHandler | undefined;
  const commands = new Map<string, { handler: CommandHandler }>();
  const flags = new Map<string, string>([
    ["dirac-tools-mode", "preferred"],
    ["dirac-override-builtins", "none"]
  ]);

  const pi = {
    registerFlag: vi.fn(),
    getFlag: vi.fn((name: string) => flags.get(name)),
    getActiveTools: vi.fn(() => [...activeTools]),
    setActiveTools: vi.fn((tools: string[]) => {
      activeTools = [...tools];
    }),
    on: vi.fn((event: string, handler: SessionStartHandler) => {
      if (event === "session_start") sessionStartHandler = handler;
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

describe("diracToolsExtension", () => {
  it("switches modes from the session-start active tool baseline", async () => {
    const mock = createMockPi(["read", "edit", "custom"]);
    const ctx = createContext();

    diracToolsExtension(mock.pi as unknown as ExtensionAPI);

    expect(mock.sessionStartHandler).toBeDefined();
    await mock.sessionStartHandler?.({}, ctx);
    expect(mock.activeTools).toEqual([
      "read",
      "edit",
      "custom",
      "read_file",
      "edit_file",
      "get_file_skeleton",
      "get_function"
    ]);

    const command = mock.commands.get("dirac-tools");
    expect(command).toBeDefined();

    await command?.handler("replacement", ctx);
    expect(mock.activeTools).toEqual([
      "custom",
      "read_file",
      "edit_file",
      "get_file_skeleton",
      "get_function",
      "write",
      "bash",
      "grep",
      "find",
      "ls"
    ]);

    await command?.handler("additive", ctx);
    expect(mock.activeTools).toEqual([
      "read",
      "edit",
      "custom",
      "read_file",
      "edit_file",
      "get_file_skeleton",
      "get_function"
    ]);
  });
});
