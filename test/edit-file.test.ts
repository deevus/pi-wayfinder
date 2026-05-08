import { describe, expect, it } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { formatLineWithHash } from "../src/anchors/line-hashing.js";
import { applyAnchoredEdits } from "../src/tools/edit-file.js";

function anchorsFor(lines: string[]): string[] {
  return new AnchorStateManager().reconcile("/tmp/a.txt", lines);
}

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
