import type { SymbolLocation } from "./symbol-scanner.js";

export interface FileSymbols {
  absolutePath: string;
  displayPath: string;
  mtimeMs: number;
  size: number;
  locations: SymbolLocation[];
}

export class SymbolCache {
  private readonly entries = new Map<string, FileSymbols>();

  get(absolutePath: string, metadata: { mtimeMs: number; size: number }): FileSymbols | undefined {
    const entry = this.entries.get(absolutePath);
    if (!entry) return undefined;
    if (entry.mtimeMs !== metadata.mtimeMs || entry.size !== metadata.size) {
      this.entries.delete(absolutePath);
      return undefined;
    }
    return entry;
  }

  set(entry: FileSymbols): void {
    this.entries.set(entry.absolutePath, entry);
  }

  delete(absolutePath: string): void {
    this.entries.delete(absolutePath);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
