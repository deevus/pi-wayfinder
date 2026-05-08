import fs from "node:fs/promises";
import * as path from "node:path";
import type { AnchorStateManager } from "../anchors/AnchorStateManager.js";
import { contentHash, formatLineWithHash } from "../anchors/line-hashing.js";
import { loadRequiredLanguageParsers } from "./language-parser.js";
import { parseFile } from "./parse-file.js";
import { SymbolContextResolver } from "./symbol-context-resolver.js";
import type { QueryMatch, SyntaxNode } from "web-tree-sitter";

export interface SymbolRange {
  startIndex: number;
  endIndex: number;
  startLine: number;
  nameText: string;
}

export interface GetFunctionsResult {
  formattedContent: string;
  foundNames: string[];
}

export class ASTAnchorBridge {
  /**
   * Gets the file skeleton with canonical anchors.
   */
  static async getFileSkeleton(
    absolutePath: string,
    anchors: AnchorStateManager,
    options?: { showCallGraph?: boolean },
  ): Promise<string | null> {
    const languageParsers = await loadRequiredLanguageParsers([absolutePath]);
    const definitions = await parseFile(absolutePath, languageParsers, options);
    if (!definitions) return null;

    const fileContent = await fs.readFile(absolutePath, "utf8");
    const lines = fileContent.split(/\r?\n/);
    const lineAnchors = anchors.reconcile(absolutePath, lines);

    let formattedOutput = "";
    let lastLineAdded = -1;

    for (const def of definitions) {
      const startLine = def.lineIndex;

      if (lastLineAdded !== -1 && startLine > lastLineAdded + 1) formattedOutput += "|----\n";

      if (startLine > lastLineAdded) {
        formattedOutput += `${formatLineWithHash(def.text, lineAnchors[startLine])}\n`;
        lastLineAdded = startLine;

        if (options?.showCallGraph) {
          if (def.lineCount !== undefined) formattedOutput += `${def.indentation}    # Lines: ${def.lineCount}\n`;
          if (def.calls?.length) formattedOutput += `${def.indentation}    # Calls: [${def.calls.sort().join(", ")}]\n`;
        }
      }
    }

    return formattedOutput.length > 0 ? `|----\n${formattedOutput}|----\n` : null;
  }

  /**
   * Gets specific functions with their context and anchors.
   */
  static async getFunctions(
    absolutePath: string,
    relPath: string,
    functionNames: string[],
    anchors: AnchorStateManager,
  ): Promise<GetFunctionsResult | null> {
    let languageParsers;
    try {
      languageParsers = await loadRequiredLanguageParsers([absolutePath]);
    } catch {
      return {
        formattedContent: `Unsupported file type: ${relPath}`,
        foundNames: [],
      };
    }

    const ext = path.extname(absolutePath).toLowerCase().slice(1);
    const { parser, query } = languageParsers[ext] || {};

    if (!parser || !query) {
      return {
        formattedContent: `Unsupported file type: ${relPath}`,
        foundNames: [],
      };
    }

    const fileContent = await fs.readFile(absolutePath, "utf8");
    let tree;
    try {
      tree = parser.parse(fileContent);
    } catch {
      return {
        formattedContent: `Could not parse file: ${relPath}`,
        foundNames: [],
      };
    }

    if (!tree?.rootNode) {
      return {
        formattedContent: `Could not parse file: ${relPath}`,
        foundNames: [],
      };
    }

    const allLines = fileContent.split(/\r?\n/);
    const allAnchors = anchors.reconcile(absolutePath, allLines);

    const matches = query.matches(tree.rootNode);
    const nodeToMatch = ASTAnchorBridge.buildNodeToMatch(matches);
    const fileResults: string[] = [];
    const foundNamesInFile = new Set<string>();
    const seenRanges = new Set<string>();

    for (const match of matches) {
      const nameCapture = match.captures.find((capture) => capture.name.includes("name.definition"));
      const defCapture =
        match.captures.find((capture) => capture.name.startsWith("definition.")) ||
        match.captures.find((capture) => !capture.name.includes("name"));

      if (!nameCapture || !defCapture) continue;

      const nameText = fileContent.slice(nameCapture.node.startIndex, nameCapture.node.endIndex);
      const fullName = ASTAnchorBridge.deriveFullName(nameText, defCapture.node, match, nodeToMatch, fileContent);
      const normalizedFullName = fullName.replace(/::/g, ".");
      const matchedReqNames = functionNames.filter((reqName) => {
        const normalizedReqName = reqName.replace(/::/g, ".");
        return normalizedFullName === normalizedReqName || normalizedFullName.endsWith(`.${normalizedReqName}`);
      });

      if (matchedReqNames.length === 0) continue;
      matchedReqNames.forEach((reqName) => foundNamesInFile.add(reqName));

      const { startIndex, endIndex, startLine } = ASTAnchorBridge.getExtendedRange(defCapture.node, fileContent);
      const rangeKey = `${startIndex}-${endIndex}`;
      if (seenRanges.has(rangeKey)) continue;
      seenRanges.add(rangeKey);

      const defText = fileContent.slice(startIndex, endIndex);
      const defLines = defText.split(/\r?\n/);
      const defAnchors = allAnchors.slice(startLine, startLine + defLines.length);
      const context = await SymbolContextResolver.resolve({
        node: defCapture.node,
        fileContent,
        parser,
        ext,
        anchors: allAnchors,
        rootNode: tree.rootNode,
      });
      const formatted = defLines.map((line, index) => formatLineWithHash(line, defAnchors[index])).join("\n");
      const funcHash = contentHash(defText);

      fileResults.push(
        `${relPath}::${fullName}\n[Function Hash: ${funcHash}]\nAll Hash Anchors provided below are stable and can be used with edit_file directly.\n${context}${formatted}`,
      );
    }

    if (fileResults.length > 0) {
      return {
        formattedContent: fileResults.join("\n\n---\n\n"),
        foundNames: Array.from(foundNamesInFile),
      };
    }

    return {
      formattedContent: `None of the requested functions (${functionNames.join(", ")}) were found in ${relPath}`,
      foundNames: [],
    };
  }

  /**
   * Gets the range of a specific symbol for replacement.
   */
  static async getSymbolRange(
    absolutePath: string,
    symbol: string,
    anchors: AnchorStateManager,
    type?: string,
  ): Promise<SymbolRange | null> {
    void anchors;

    let languageParsers;
    try {
      languageParsers = await loadRequiredLanguageParsers([absolutePath]);
    } catch {
      return null;
    }

    const ext = path.extname(absolutePath).toLowerCase().slice(1);
    const { parser, query } = languageParsers[ext] || {};
    if (!parser || !query) return null;

    const fileContent = await fs.readFile(absolutePath, "utf8");
    let tree;
    try {
      tree = parser.parse(fileContent);
    } catch {
      return null;
    }
    if (!tree?.rootNode) return null;

    const matches = query.matches(tree.rootNode);
    const nodeToMatch = ASTAnchorBridge.buildNodeToMatch(matches);
    const normalizedRequestedSymbol = symbol.replace(/::/g, ".");

    for (const match of matches) {
      const nameCapture = match.captures.find((capture) => capture.name.startsWith("name.definition"));
      const defCapture =
        match.captures.find((capture) => capture.name.startsWith("definition.")) ||
        match.captures.find((capture) => !capture.name.startsWith("name."));

      if (!nameCapture || !defCapture) continue;

      const nameText = fileContent.slice(nameCapture.node.startIndex, nameCapture.node.endIndex);
      const defType = defCapture.name.split(".").pop() || "";
      const fullName = ASTAnchorBridge.deriveFullName(nameText, defCapture.node, match, nodeToMatch, fileContent);
      const normalizedFullName = fullName.replace(/::/g, ".");

      if (
        (normalizedFullName === normalizedRequestedSymbol || normalizedFullName.endsWith(`.${normalizedRequestedSymbol}`)) &&
        ASTAnchorBridge.areTypesCompatible(defType, type)
      ) {
        const range = ASTAnchorBridge.getExtendedRange(defCapture.node, fileContent);
        return {
          ...range,
          nameText,
        };
      }
    }

    return null;
  }

  private static buildNodeToMatch(matches: QueryMatch[]): Map<number, QueryMatch> {
    const nodeToMatch = new Map<number, QueryMatch>();
    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name.startsWith("name.")) nodeToMatch.set(capture.node.id, match);
        if (capture.name.startsWith("definition.")) nodeToMatch.set(capture.node.id, match);
      }
    }
    return nodeToMatch;
  }

  private static deriveFullName(
    nameText: string,
    definitionNode: SyntaxNode,
    match: QueryMatch,
    nodeToMatch: Map<number, QueryMatch>,
    fileContent: string,
  ): string {
    let fullName = nameText;
    let currentNode: SyntaxNode | null = definitionNode;
    const seenMatches = new Set<QueryMatch>([match]);

    while (currentNode.parent) {
      currentNode = currentNode.parent;
      const parentMatch = nodeToMatch.get(currentNode.id);
      if (parentMatch && !seenMatches.has(parentMatch)) {
        const parentNameCap = parentMatch.captures.find((capture) => capture.name.startsWith("name."));
        if (parentNameCap) {
          const parentNameText = fileContent.slice(parentNameCap.node.startIndex, parentNameCap.node.endIndex);
          fullName = `${parentNameText}.${fullName}`;
          seenMatches.add(parentMatch);
        }
      }
    }

    return fullName;
  }

  private static areTypesCompatible(defType: string, reqType?: string): boolean {
    if (!reqType) return true;
    if (defType === reqType) return true;
    const synonyms = ["function", "method"];
    return synonyms.includes(defType) && synonyms.includes(reqType);
  }

  private static getExtendedRange(targetNode: SyntaxNode, fileContent: string): { startIndex: number; endIndex: number; startLine: number } {
    let startIndex = targetNode.startIndex;
    let endIndex = targetNode.endIndex;
    let startLine = targetNode.startPosition.row;
    let currentNode = targetNode;
    const wrapperTypes = [
      "export_statement",
      "export_declaration",
      "ambient_declaration",
      "decorated_definition",
      "internal_module",
    ];

    while (currentNode.parent && wrapperTypes.includes(currentNode.parent.type)) {
      currentNode = currentNode.parent;
      startIndex = currentNode.startIndex;
      endIndex = currentNode.endIndex;
      startLine = currentNode.startPosition.row;
    }

    while (currentNode.previousNamedSibling) {
      const prev = currentNode.previousNamedSibling;
      if (
        prev.type === "comment" ||
        prev.type === "decorator" ||
        prev.type === "attribute" ||
        prev.type.includes("comment")
      ) {
        startIndex = prev.startIndex;
        startLine = prev.startPosition.row;
        currentNode = prev;
      } else {
        break;
      }
    }

    startIndex = fileContent.lastIndexOf("\n", startIndex - 1) + 1;

    return { startIndex, endIndex, startLine };
  }
}
