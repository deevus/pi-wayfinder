import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { contentHash } from "../src/anchors/line-hashing.js";
import { registerReadFileTool } from "../src/tools/read-file.js";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-read-file-"));
  tempDirs.push(dir);
  return dir;
}

function registerToolForTest(): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    })
  };

  registerReadFileTool(pi as unknown as ExtensionAPI, new AnchorStateManager());

  expect(registeredTool).toBeDefined();
  expect(registeredTool?.name).toBe("read_file");
  expect(registeredTool?.label).toBe("Read File Anchored");
  expect(registeredTool?.description).toContain("stable line anchors");
  return registeredTool as RegisteredTool;
}

describe("read_file tool", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns a file hash and selected anchored lines for a line range", async () => {
    const cwd = await createTempDir();
    const content = "alpha\nbeta\ngamma\ndelta";
    await writeFile(join(cwd, "sample.txt"), content, "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute(
      "call-1",
      { paths: ["sample.txt"], start_line: 2, end_line: 3 },
      undefined,
      undefined,
      { cwd } as never
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- sample.txt ---");
    expect(text).toContain(`[File Hash: ${contentHash(content)}]`);
    expect(text).toContain("DiracB│beta");
    expect(text).toContain("DiracC│gamma");
    expect(text).not.toContain("DiracA│alpha");
    expect(text).not.toContain("DiracD│delta");
    expect(result.details).toEqual({ paths: ["sample.txt"] });
  });

  it("accepts a leading @ on requested paths", async () => {
    const cwd = await createTempDir();
    const content = "first\nsecond";
    await writeFile(join(cwd, "at-path.txt"), content, "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-2", { paths: ["@at-path.txt"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- @at-path.txt ---");
    expect(text).toContain(`[File Hash: ${contentHash(content)}]`);
    expect(text).toContain("DiracA│first");
    expect(text).toContain("DiracB│second");
    expect(result.details).toEqual({ paths: ["@at-path.txt"] });
  });
});
