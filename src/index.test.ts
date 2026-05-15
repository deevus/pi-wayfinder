import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { WayfinderToolMode } from "./mode.js";
import wayfinderExtension from "./index.js";

type SessionEntry = {
  type: string;
  customType?: string;
  data?: unknown;
};

type UiContext = {
  ui: {
    setStatus: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
  };
  sessionManager: {
    getEntries: ReturnType<typeof vi.fn<() => SessionEntry[]>>;
  };
};

type SessionStartHandler = (event: unknown, ctx: UiContext) => Promise<void> | void;
type BeforeAgentStartHandler = (event: { systemPrompt: string }) => Promise<{ systemPrompt: string }> | { systemPrompt: string };
type CommandHandler = (args: string, ctx: UiContext) => Promise<void> | void;
function createMockPi(initialTools: string[], options: { flagMode?: WayfinderToolMode } = {}) {
  let activeTools = [...initialTools];
  let sessionStartHandler: SessionStartHandler | undefined;
  let beforeAgentStartHandler: BeforeAgentStartHandler | undefined;
  const commands = new Map<string, { handler: CommandHandler }>();
  const flags = new Map<string, string>([["wayfinder-override-builtins", "none"]]);
  if (options.flagMode !== undefined) flags.set("wayfinder-mode", options.flagMode);

  const pi = {
    registerTool: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn((name: string) => flags.get(name)),
    appendEntry: vi.fn(),
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

function createContext(entries: SessionEntry[] = []): UiContext {
  return {
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn()
    },
    sessionManager: {
      getEntries: vi.fn(() => entries)
    }
  };
}

const expectedWayfinderTools = [
  "read_file",
  "edit_file",
  "get_file_skeleton",
  "get_function",
  "replace_symbol",
  "find_symbol_references",
  "rename_symbol"
];

describe("wayfinderExtension", () => {
  it("switches modes from the session-start active tool baseline", async () => {
    const mock = createMockPi(["read", "edit", "custom"]);
    const ctx = createContext();

    wayfinderExtension(mock.pi as unknown as ExtensionAPI);

    const registeredFlags = mock.pi.registerFlag.mock.calls.map(([name]) => name);
    expect(registeredFlags).toContain("wayfinder-mode");
    expect(registeredFlags).not.toContain("dirac-tools-mode");
    expect(mock.commands.has("wayfinder")).toBe(true);
    expect(mock.commands.has("dirac-tools")).toBe(false);

    expect(mock.sessionStartHandler).toBeDefined();
    await mock.sessionStartHandler?.({}, ctx);
    expect(mock.activeTools).toEqual(["read", "edit", "custom", ...expectedWayfinderTools]);

    const command = mock.commands.get("wayfinder");
    expect(command).toBeDefined();

    await command?.handler("replacement", ctx);
    expect(mock.activeTools).toEqual(["read", "custom", ...expectedWayfinderTools, "write", "bash", "grep", "find", "ls"]);

    await command?.handler("additive", ctx);
    expect(mock.activeTools).toEqual(["read", "edit", "custom", ...expectedWayfinderTools]);
  });

  it("uses command-selected mode for injected prompt guidance", async () => {
    const mock = createMockPi(["read", "edit"]);
    const ctx = createContext();

    wayfinderExtension(mock.pi as unknown as ExtensionAPI);

    expect(mock.beforeAgentStartHandler).toBeDefined();
    const command = mock.commands.get("wayfinder");
    expect(command).toBeDefined();

    await command?.handler("replacement", ctx);
    const result = await mock.beforeAgentStartHandler?.({ systemPrompt: "base" });

    expect(result?.systemPrompt).toContain("Replacement mode is active.");
    expect(result?.systemPrompt).not.toContain("Preferred mode is active.");
    expect(result?.systemPrompt).toContain("Use replace_symbol for whole-symbol replacements");
  });

  it("persists command-selected mode to the session", async () => {
    const mock = createMockPi(["read", "edit"]);
    const ctx = createContext();

    wayfinderExtension(mock.pi as unknown as ExtensionAPI);
    const command = mock.commands.get("wayfinder");

    await command?.handler("replacement", ctx);

    expect(mock.pi.appendEntry).toHaveBeenCalledWith("pi-wayfinder:mode", { mode: "replacement" });
  });


  it("does not restore deprecated dirac session keys", async () => {
    const mock = createMockPi(["read", "edit", "custom"]);
    const ctx = createContext([{ type: "custom", customType: "pi-dirac-tools:mode", data: { mode: "replacement" } }]);

    wayfinderExtension(mock.pi as unknown as ExtensionAPI);
    await mock.sessionStartHandler?.({}, ctx);

    expect(mock.activeTools).toEqual(["read", "edit", "custom", ...expectedWayfinderTools]);
  });
  it("restores latest persisted mode on session start", async () => {
    const mock = createMockPi(["read", "edit", "custom"]);
    const ctx = createContext([
      { type: "custom", customType: "pi-wayfinder:mode", data: { mode: "additive" } },
      { type: "custom", customType: "pi-wayfinder:mode", data: { mode: "replacement" } }
    ]);

    wayfinderExtension(mock.pi as unknown as ExtensionAPI);
    await mock.sessionStartHandler?.({}, ctx);

    expect(mock.activeTools).toEqual(["read", "custom", ...expectedWayfinderTools, "write", "bash", "grep", "find", "ls"]);
    const result = await mock.beforeAgentStartHandler?.({ systemPrompt: "base" });
    expect(result?.systemPrompt).toContain("Replacement mode is active.");
  });

  it("uses an explicit CLI flag instead of persisted mode", async () => {
    const mock = createMockPi(["read", "edit", "custom"], { flagMode: "preferred" });
    const ctx = createContext([{ type: "custom", customType: "pi-wayfinder:mode", data: { mode: "replacement" } }]);

    wayfinderExtension(mock.pi as unknown as ExtensionAPI);
    await mock.sessionStartHandler?.({}, ctx);

    expect(mock.activeTools).toEqual(["read", "edit", "custom", ...expectedWayfinderTools]);
    const result = await mock.beforeAgentStartHandler?.({ systemPrompt: "base" });
    expect(result?.systemPrompt).toContain("Preferred mode is active.");
  });


  it("registers replace_symbol with the extension tools", () => {
    const mock = createMockPi(["read", "edit"]);

    wayfinderExtension(mock.pi as unknown as ExtensionAPI);

    const registeredNames = mock.pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(registeredNames).toEqual(expectedWayfinderTools);
  });
});
