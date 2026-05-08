import * as diff from "diff";

interface TrackedDocument {
  hashes: Uint32Array;
  anchors: string[];
  nextId: number;
}

function computeHashes(lines: string[]): Uint32Array {
  const hashes = new Uint32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    let h = 2166136261;
    for (let j = 0; j < lines[i].length; j++) h = Math.imul(h ^ lines[i].charCodeAt(j), 16777619);
    hashes[i] = h >>> 0;
  }
  return hashes;
}

function anchorName(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let n = index;
  let out = "";
  do {
    out = alphabet[n % alphabet.length] + out;
    n = Math.floor(n / alphabet.length) - 1;
  } while (n >= 0);
  return `Dirac${out}`;
}

export class AnchorStateManager {
  private documents = new Map<string, TrackedDocument>();

  reconcile(absolutePath: string, currentLines: string[]): string[] {
    const currentHashes = computeHashes(currentLines);
    const tracked = this.documents.get(absolutePath);

    if (!tracked) {
      const anchors = currentLines.map((_, i) => anchorName(i));
      this.documents.set(absolutePath, { hashes: currentHashes, anchors, nextId: currentLines.length });
      return anchors;
    }

    if (tracked.hashes.length === currentHashes.length && tracked.hashes.every((h, i) => h === currentHashes[i])) {
      return tracked.anchors;
    }

    const changes = diff.diffArrays(Array.from(tracked.hashes), Array.from(currentHashes));
    const anchors: string[] = [];
    let oldIndex = 0;
    let nextId = tracked.nextId;

    for (const change of changes) {
      if (change.added) {
        for (let i = 0; i < (change.count ?? 0); i++) anchors.push(anchorName(nextId++));
      } else if (change.removed) {
        oldIndex += change.count ?? 0;
      } else {
        for (let i = 0; i < (change.count ?? 0); i++) anchors.push(tracked.anchors[oldIndex++]);
      }
    }

    this.documents.set(absolutePath, { hashes: currentHashes, anchors, nextId });
    return anchors;
  }

  getAnchors(absolutePath: string): string[] | undefined {
    return this.documents.get(absolutePath)?.anchors;
  }
}
