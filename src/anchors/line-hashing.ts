export const ANCHOR_DELIMITER = "│";

export function getDelimiter(): string {
  return ANCHOR_DELIMITER;
}

export function contentHash(content: string): string {
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) {
    h = Math.imul(h ^ content.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function formatLineWithHash(content: string, anchor: string): string {
  return `${anchor}${ANCHOR_DELIMITER}${content}`;
}

export function splitAnchor(rawAnchor: string): { anchor: string; content: string } {
  const index = rawAnchor.indexOf(ANCHOR_DELIMITER);
  if (index === -1) return { anchor: rawAnchor.trim(), content: "" };
  return {
    anchor: rawAnchor.slice(0, index).trim(),
    content: rawAnchor.slice(index + ANCHOR_DELIMITER.length)
  };
}

export function stripHashes(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const index = line.indexOf(ANCHOR_DELIMITER);
      if (index === -1) return line;
      const maybeAnchor = line.slice(0, index);
      return /^[A-Z][a-zA-Z]*$/.test(maybeAnchor) ? line.slice(index + ANCHOR_DELIMITER.length) : line;
    })
    .join("\n");
}
