export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024;

export interface OutputAccumulator {
  parts: string[];
  lineCount: number;
  byteCount: number;
  truncated: boolean;
}

export function createOutputAccumulator(): OutputAccumulator {
  return { parts: [], lineCount: 0, byteCount: 0, truncated: false };
}

export function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw signal.reason ?? new Error(message);
}

export function appendOutputLine(output: OutputAccumulator, line: string): boolean {
  if (output.truncated) return false;
  if (output.lineCount >= MAX_OUTPUT_LINES) {
    output.truncated = true;
    return false;
  }

  const separatorBytes = output.lineCount === 0 ? 0 : Buffer.byteLength("\n", "utf8");
  const lineBytes = Buffer.byteLength(line, "utf8");
  if (output.byteCount + separatorBytes + lineBytes > MAX_OUTPUT_BYTES) {
    output.truncated = true;
    return false;
  }

  if (output.lineCount > 0) output.parts.push("\n");
  output.parts.push(line);
  output.lineCount++;
  output.byteCount += separatorBytes + lineBytes;
  return true;
}

export function appendTruncationNotice(text: string, output: OutputAccumulator): string {
  if (!output.truncated) return text;

  const notice = `[Output truncated: showing the first ${output.lineCount} lines within ${MAX_OUTPUT_BYTES} bytes. Narrow the request to inspect omitted content.]`;
  return text.length > 0 ? `${text}\n\n${notice}` : notice;
}
