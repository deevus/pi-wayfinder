import { describe, expect, it } from "vitest";
import { AnchorStateManager } from "../src/anchors/AnchorStateManager.js";
import { formatLineWithHash, splitAnchor, stripHashes } from "../src/anchors/line-hashing.js";

describe("anchors", () => {
  it("preserves anchors for unchanged lines across insertions", () => {
    const manager = new AnchorStateManager();
    const first = manager.reconcile("/tmp/a.ts", ["one", "two", "three"]);
    const second = manager.reconcile("/tmp/a.ts", ["one", "inserted", "two", "three"]);

    expect(second[0]).toBe(first[0]);
    expect(second[2]).toBe(first[1]);
    expect(second[3]).toBe(first[2]);
    expect(second[1]).not.toBe(first[1]);
    expect(manager.getAnchors("/tmp/a.ts")).toBe(second);
  });

  it("splits and strips anchor-prefixed lines", () => {
    const line = formatLineWithHash("const x = 1", "DiracA");

    expect(splitAnchor(line)).toEqual({ anchor: "DiracA", content: "const x = 1" });
    expect(splitAnchor(" DiracB ")).toEqual({ anchor: "DiracB", content: "" });
    expect(stripHashes(`${line}\nno-anchor│kept\nplain`)).toBe("const x = 1\nno-anchor│kept\nplain");
  });
});
