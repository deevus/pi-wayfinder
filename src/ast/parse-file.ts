import * as fs from "node:fs/promises";
import * as path from "node:path";
import Parser from "web-tree-sitter";
import type { LanguageParser } from "./language-parser.js";

export interface ParsedDefinition {
  lineIndex: number;
  text: string;
  indentation: string;
  lineCount?: number;
  calls?: string[];
}

export interface ParseFileOptions {
  showCallGraph?: boolean;
}

export async function parseFile(
  filePath: string,
  languageParsers: LanguageParser,
  options?: ParseFileOptions,
): Promise<ParsedDefinition[] | null> {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const { parser, query } = languageParsers[ext] || {};
    if (!parser || !query) return null;

    const tree = parser.parse(fileContent);
    if (!tree?.rootNode) return null;

    const captures = query.captures(tree.rootNode);
    const lines = fileContent.split("\n");
    const definitions: ParsedDefinition[] = [];
    const definedNames = new Set<string>();
    const allReferences: { node: Parser.SyntaxNode; text: string; line: number }[] = [];
    const definitionNodes = new Map<number, string>();

    for (const capture of captures) {
      if (capture.name.includes("definition") && !capture.name.includes("name.definition")) {
        definitionNodes.set(capture.node.id, capture.name);
      }

      if (options?.showCallGraph) {
        if (capture.name.includes("name.definition.function") || capture.name.includes("name.definition.method")) {
          definedNames.add(capture.node.text);
        } else if (capture.name.includes("name.reference")) {
          allReferences.push({ node: capture.node, text: capture.node.text, line: capture.node.startPosition.row });
        }
      }
    }

    captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row);
    let lastLineAdded = -1;

    for (const capture of captures) {
      const { node, name } = capture;
      const startLine = node.startPosition.row;

      if (!name.includes("name.definition") || !lines[startLine]) continue;
      if (startLine <= lastLineAdded) continue;

      const def: ParsedDefinition = {
        lineIndex: startLine,
        text: lines[startLine],
        indentation: lines[startLine].match(/^\s*/)?.[0] || "",
      };
      lastLineAdded = startLine;

      if (options?.showCallGraph) {
        let definitionNode: Parser.SyntaxNode | null = null;
        let current: Parser.SyntaxNode | null = node;
        while (current) {
          if (definitionNodes.has(current.id)) {
            definitionNode = current;
            break;
          }
          current = current.parent;
        }

        if (definitionNode) {
          const startRow = definitionNode.startPosition.row;
          const endRow = definitionNode.endPosition.row;

          if (
            name.includes("name.definition.function") ||
            name.includes("name.definition.method") ||
            name.includes("name.definition.class") ||
            name.includes("name.definition.interface")
          ) {
            def.lineCount = endRow - startRow + 1;
          }

          if (name.includes("name.definition.function") || name.includes("name.definition.method")) {
            const localCalls = new Set<string>();
            for (const ref of allReferences) {
              if (ref.line >= startRow && ref.line <= endRow && definedNames.has(ref.text) && ref.text !== node.text) {
                if (isCallNode(ref.node)) localCalls.add(ref.text);
              }
            }
            if (localCalls.size > 0) def.calls = Array.from(localCalls);
          }
        }
      }

      definitions.push(def);
    }

    return definitions.length > 0 ? definitions : null;
  } catch {
    return null;
  }
}

function isCallNode(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;

  const callTypes = [
    "call",
    "call_expression",
    "method_invocation",
    "function_call_expression",
    "member_call_expression",
    "invocation_expression",
  ];
  if (callTypes.includes(parent.type)) return true;

  const memberTypes = ["member_expression", "member_access_expression", "property_access", "member_call_expression"];
  if (memberTypes.includes(parent.type)) {
    const grandParent = parent.parent;
    return !!grandParent && callTypes.includes(grandParent.type);
  }

  return false;
}
