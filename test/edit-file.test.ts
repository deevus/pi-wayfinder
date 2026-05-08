import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../src/anchors/line-hashing.js";
import { applyAnchoredEdits, registerEditFileTool } from "../src/tools/edit-file.js";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dirac-edit-file-"));
  tempDirs.push(dir);
  return dir;
}

function registerToolForTest(anchors = new AnchorStateManager()): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      registeredTool = tool;
    })
  };

  registerEditFileTool(pi as unknown as ExtensionAPI, anchors);

  expect(registeredTool).toBeDefined();
  expect(registeredTool?.name).toBe("edit_file");
  return registeredTool as RegisteredTool;
}

function anchorsFor(lines: string[]): string[] {
  return new AnchorStateManager().reconcile("/tmp/a.txt", lines);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("applyAnchoredEdits", () => {
  it("applies replace, insert_before, and insert_after edits", () => {
    const lines = ["one", "two", "three"];
    const anchors = anchorsFor(lines);

    const next = applyAnchoredEdits(lines, anchors, [
      {
        edit_type: "replace",
        anchor: formatLineWithHash("two", anchors[1]),
        end_anchor: formatLineWithHash("two", anchors[1]),
        text: "TWO"
      },
      { edit_type: "insert_before", anchor: formatLineWithHash("one", anchors[0]), text: "zero" },
      { edit_type: "insert_after", anchor: formatLineWithHash("three", anchors[2]), text: "four" }
    ]);

    expect(next).toEqual(["zero", "one", "TWO", "three", "four"]);
  });

  it("rejects stale anchor content", () => {
    const lines = ["one", "two"];
    const anchors = anchorsFor(lines);

    expect(() =>
      applyAnchoredEdits(lines, anchors, [
        {
          edit_type: "replace",
          anchor: formatLineWithHash("wrong", anchors[0]),
          end_anchor: formatLineWithHash("one", anchors[0]),
          text: "ONE"
        }
      ])
    ).toThrow(/content mismatch/);
  });

  it("rejects overlapping edits", () => {
    const lines = ["one", "two", "three"];
    const anchors = anchorsFor(lines);

    expect(() =>
      applyAnchoredEdits(lines, anchors, [
        {
          edit_type: "replace",
          anchor: formatLineWithHash("one", anchors[0]),
          end_anchor: formatLineWithHash("two", anchors[1]),
          text: "ONE\nTWO"
        },
        {
          edit_type: "replace",
          anchor: formatLineWithHash("two", anchors[1]),
          end_anchor: formatLineWithHash("three", anchors[2]),
          text: "TWO\nTHREE"
        }
      ])
    ).toThrow(/overlapping edits/);
  });

  it("deletes a replace range when text is empty", () => {
    const lines = ["one", "two", "three"];
    const anchors = anchorsFor(lines);

    const next = applyAnchoredEdits(lines, anchors, [
      {
        edit_type: "replace",
        anchor: formatLineWithHash("two", anchors[1]),
        end_anchor: formatLineWithHash("two", anchors[1]),
        text: ""
      }
    ]);

    expect(next).toEqual(["one", "three"]);
  });

  it("strips anchors from replacement text before applying edits", () => {
    const lines = ["one", "two"];
    const anchors = anchorsFor(lines);

    const next = applyAnchoredEdits(lines, anchors, [
      {
        edit_type: "replace",
        anchor: formatLineWithHash("two", anchors[1]),
        end_anchor: formatLineWithHash("two", anchors[1]),
        text: `${anchors[1]}│TWO`
      }
    ]);

    expect(next).toEqual(["one", "TWO"]);
  });
});

describe("edit_file tool", () => {
  it("preserves CRLF line endings when applying edits", async () => {
    const cwd = await createTempDir();
    const path = join(cwd, "crlf.txt");
    const original = "alpha\r\nbeta\r\ngamma\r\n";
    await writeFile(path, original, "utf8");

    const lines = original.split(/\r?\n/);
    const anchors = anchorsFor(lines);
    const tool = registerToolForTest();

    await tool.execute(
      "call-1",
      {
        files: [
          {
            path: "crlf.txt",
            edits: [
              {
                edit_type: "replace",
                anchor: formatLineWithHash("beta", anchors[1]),
                end_anchor: formatLineWithHash("beta", anchors[1]),
                text: "BETA"
              }
            ]
          }
        ]
      },
      undefined,
      undefined,
      { cwd } as never
    );

    await expect(readFile(path, "utf8")).resolves.toBe("alpha\r\nBETA\r\ngamma\r\n");
  });

  it("passes the abort signal to confirmation and does not write when aborted", async () => {
    const cwd = await createTempDir();
    const path = join(cwd, "abort.txt");
    const original = "alpha\nbeta\n";
    await writeFile(path, original, "utf8");

    const anchors = anchorsFor(original.split(/\r?\n/));
    const tool = registerToolForTest();
    const controller = new AbortController();
    const abortReason = new Error("edit aborted");
    const confirm = vi.fn(async (_title: string, _message: string, opts?: { signal?: AbortSignal }) => {
      expect(opts?.signal).toBe(controller.signal);
      controller.abort(abortReason);
      return true;
    });

    await expect(
      tool.execute(
        "call-2",
        {
          files: [
            {
              path: "abort.txt",
              edits: [
                {
                  edit_type: "replace",
                  anchor: formatLineWithHash("beta", anchors[1]),
                  end_anchor: formatLineWithHash("beta", anchors[1]),
                  text: "BETA"
                }
              ]
            }
          ]
        },
        controller.signal,
        undefined,
        { cwd, hasUI: true, ui: { confirm } } as never
      )
    ).rejects.toThrow("edit aborted");

    expect(confirm).toHaveBeenCalledTimes(1);
    await expect(readFile(path, "utf8")).resolves.toBe(original);
  });
});
