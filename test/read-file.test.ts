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
  const dir = await mkdtemp(join(tmpdir(), "pi-wayfinder-read-file-"));
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
    expect(text).toContain("WayB│beta");
    expect(text).toContain("WayC│gamma");
    expect(text).not.toContain("WayA│alpha");
    expect(text).not.toContain("WayD│delta");
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
    expect(text).toContain("WayA│first");
    expect(text).toContain("WayB│second");
    expect(result.details).toEqual({ paths: ["@at-path.txt"] });
  });

  it("supports inline per-path ranges without applying them to other paths", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "short.txt"), "alpha\nbeta", "utf8");
    await writeFile(join(cwd, "long.txt"), Array.from({ length: 5 }, (_, index) => `line-${index + 1}`).join("\n"), "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-inline-range", { paths: ["short.txt", "long.txt:3-4"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- short.txt ---");
    expect(text).toContain("WayA│alpha");
    expect(text).toContain("WayB│beta");
    expect(text).toContain("--- long.txt:3-4 ---");
    expect(text).toContain("WayC│line-3");
    expect(text).toContain("WayD│line-4");
    expect(text).not.toContain("WayE│line-5");
  });

  it("does not fail a mixed multi-file read when a global range starts beyond a short file", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "short.txt"), "alpha\nbeta", "utf8");
    await writeFile(join(cwd, "long.txt"), Array.from({ length: 5 }, (_, index) => `line-${index + 1}`).join("\n"), "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-mixed-range", { paths: ["short.txt", "long.txt"], start_line: 3, end_line: 4 }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- short.txt ---");
    expect(text).toContain("WayA│alpha");
    expect(text).toContain("WayB│beta");
    expect(text).toContain("--- long.txt ---");
    expect(text).toContain("WayC│line-3");
    expect(text).toContain("WayD│line-4");
    expect(text).not.toContain("WayE│line-5");
  });


  it("declares line range parameters as positive integers", () => {
    const tool = registerToolForTest();
    const properties = (tool.parameters as { properties: Record<string, { type: string; minimum?: number }> }).properties;

    expect(properties.start_line).toMatchObject({ type: "integer", minimum: 1 });
    expect(properties.end_line).toMatchObject({ type: "integer", minimum: 1 });
  });

  it("rejects fractional line ranges", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.txt"), "alpha\nbeta", "utf8");

    const tool = registerToolForTest();
    await expect(
      tool.execute("call-3", { paths: ["sample.txt"], start_line: 1.5 }, undefined, undefined, { cwd } as never)
    ).rejects.toThrow("start_line must be an integer");
    await expect(
      tool.execute("call-4", { paths: ["sample.txt"], end_line: 1.5 }, undefined, undefined, { cwd } as never)
    ).rejects.toThrow("end_line must be an integer");
  });

  it("rejects invalid line ranges", async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, "sample.txt"), "alpha\nbeta", "utf8");

    const tool = registerToolForTest();
    await expect(
      tool.execute("call-5", { paths: ["sample.txt"], start_line: 2, end_line: 1 }, undefined, undefined, { cwd } as never)
    ).rejects.toThrow("start_line must be less than or equal to end_line");
    await expect(
      tool.execute("call-6", { paths: ["sample.txt"], start_line: 3 }, undefined, undefined, { cwd } as never)
    ).rejects.toThrow("start_line 3 is beyond end of file (2 lines)");
  });

  it("truncates large output and appends a notice", async () => {
    const cwd = await createTempDir();
    const content = Array.from({ length: 2500 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(join(cwd, "large.txt"), content, "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-7", { paths: ["large.txt"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- large.txt ---");
    expect(text).toContain(`[File Hash: ${contentHash(content)}]`);
    expect(text).toContain("line-1998");
    expect(text).not.toContain("line-2500");
    expect(text).toContain("[Output truncated: showing the first 2000 lines within 51200 bytes.");
  });

  it("truncates output that exceeds the byte cap", async () => {
    const cwd = await createTempDir();
    const content = "x".repeat(60 * 1024);
    await writeFile(join(cwd, "huge-line.txt"), content, "utf8");

    const tool = registerToolForTest();
    const result = await tool.execute("call-8", { paths: ["huge-line.txt"] }, undefined, undefined, { cwd } as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("--- huge-line.txt ---");
    expect(text).toContain(`[File Hash: ${contentHash(content)}]`);
    expect(text).not.toContain("WayA│xxx");
    expect(text).toContain("[Output truncated: showing the first 2 lines within 51200 bytes.");
  });
});
