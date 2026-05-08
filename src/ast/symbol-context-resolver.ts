import { formatLineWithHash } from "../anchors/line-hashing.js";
import Parser, { type QueryCapture, type SyntaxNode } from "web-tree-sitter";

export interface SymbolContextResolverOptions {
  node: SyntaxNode;
  fileContent: string;
  parser: Parser;
  ext: string;
  anchors: string[];
  maxContextLines?: number;
  rootNode?: SyntaxNode;
}

interface ContextQueryStrings {
  contextQuery: string;
  importCaptureName: string;
  classCaptureName: string;
  classNodeTypes: string[];
  propertyCaptureNames: string[];
  referenceCaptureNames: string[];
}

export class SymbolContextResolver {
  private static readonly MAX_CONTEXT_LINES = 30;

  /**
   * Resolves relevant context (imports and class properties) for a given symbol node.
   */
  static async resolve(options: SymbolContextResolverOptions): Promise<string> {
    const {
      node,
      fileContent,
      parser,
      ext,
      anchors,
      maxContextLines = SymbolContextResolver.MAX_CONTEXT_LINES,
      rootNode: providedRootNode,
    } = options;

    const language = parser.getLanguage();
    const queryStrings = SymbolContextResolver.getQueryStrings(ext);
    if (!queryStrings) return "";

    try {
      const rootNode = providedRootNode || parser.parse(fileContent).rootNode;
      const query = language.query(queryStrings.contextQuery);
      const captures = query.captures(rootNode);

      const usedIdentifiers = SymbolContextResolver.getUsedIdentifiers(node);
      const relevantImports = SymbolContextResolver.getRelevantImports(
        captures,
        usedIdentifiers,
        queryStrings.importCaptureName,
      );
      const classContext = SymbolContextResolver.getClassContext(node, captures, usedIdentifiers, queryStrings);

      return SymbolContextResolver.assembleContext(relevantImports, classContext, fileContent, anchors, maxContextLines);
    } catch {
      return "";
    }
  }

  private static getQueryStrings(ext: string): ContextQueryStrings | null {
    switch (ext) {
      case "ts":
      case "tsx":
        return {
          contextQuery: `
            (import_statement) @import
            (class_declaration) @class
            (class_heritage) @class.heritage
            (public_field_definition) @property
            (method_definition) @method
            (identifier) @ref
            (property_identifier) @ref
          `,
          importCaptureName: "import",
          classCaptureName: "class",
          classNodeTypes: ["class_declaration"],
          propertyCaptureNames: ["property"],
          referenceCaptureNames: ["ref"],
        };
      case "js":
      case "jsx":
        return {
          contextQuery: `
            (import_statement) @import
            (class_declaration) @class
            (field_definition) @property
            (method_definition) @method
            (identifier) @ref
            (property_identifier) @ref
          `,
          importCaptureName: "import",
          classCaptureName: "class",
          classNodeTypes: ["class_declaration"],
          propertyCaptureNames: ["property"],
          referenceCaptureNames: ["ref"],
        };
      case "py":
        return {
          contextQuery: `
            (import_from_statement) @import
            (import_statement) @import
            (class_definition) @class
            (function_definition) @method
            (assignment left: (attribute object: (identifier) @self attribute: (identifier) @property)) @property
            (identifier) @ref
          `,
          importCaptureName: "import",
          classCaptureName: "class",
          classNodeTypes: ["class_definition"],
          propertyCaptureNames: ["property"],
          referenceCaptureNames: ["ref"],
        };
      case "java":
        return {
          contextQuery: `
            (import_declaration) @import
            (class_declaration) @class
            (field_declaration) @property
            (method_declaration) @method
            (identifier) @ref
          `,
          importCaptureName: "import",
          classCaptureName: "class",
          classNodeTypes: ["class_declaration"],
          propertyCaptureNames: ["property"],
          referenceCaptureNames: ["ref"],
        };
      default:
        return null;
    }
  }

  private static getUsedIdentifiers(node: SyntaxNode): Set<string> {
    const identifiers = new Set<string>();
    const walk = (n: SyntaxNode): void => {
      if (n.type.includes("identifier")) identifiers.add(n.text);
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) walk(child);
      }
    };
    walk(node);
    return identifiers;
  }

  private static getRelevantImports(
    captures: QueryCapture[],
    usedIdentifiers: Set<string>,
    importCaptureName: string,
  ): SyntaxNode[] {
    const relevant: SyntaxNode[] = [];
    for (const capture of captures) {
      if (capture.name === importCaptureName) {
        const importText = capture.node.text;
        for (const id of usedIdentifiers) {
          const regex = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
          if (regex.test(importText)) {
            relevant.push(capture.node);
            break;
          }
        }
      }
    }
    return relevant;
  }

  private static getClassContext(
    node: SyntaxNode,
    captures: QueryCapture[],
    usedIdentifiers: Set<string>,
    queryStrings: ContextQueryStrings,
  ): { classNode: SyntaxNode; propertyNodes: SyntaxNode[] } | null {
    let parent = node.parent;
    while (parent && !queryStrings.classNodeTypes.includes(parent.type)) parent = parent.parent;

    if (!parent) return null;

    const classNode = parent;
    const propertyNodes: SyntaxNode[] = [];

    for (const capture of captures) {
      if (!queryStrings.propertyCaptureNames.includes(capture.name)) continue;

      let propertyParent = capture.node.parent;
      let belongsToClass = false;
      while (propertyParent) {
        if (propertyParent.id === classNode.id) {
          belongsToClass = true;
          break;
        }
        propertyParent = propertyParent.parent;
      }

      if (!belongsToClass) continue;

      let nameNode: SyntaxNode | null = capture.node.childForFieldName("name");
      if (!nameNode) {
        const findName = (n: SyntaxNode): SyntaxNode | null => {
          if (
            n.type === "property_identifier" ||
            (n.type === "identifier" && n.text !== "self" && n.text !== "this")
          ) {
            return n;
          }
          for (let i = 0; i < n.childCount; i++) {
            const child = n.child(i);
            if (!child) continue;
            const found = findName(child);
            if (found) return found;
          }
          return null;
        };
        nameNode = findName(capture.node);
      }

      if (nameNode && usedIdentifiers.has(nameNode.text)) propertyNodes.push(capture.node);
    }

    return { classNode, propertyNodes };
  }

  private static assembleContext(
    imports: SyntaxNode[],
    classContext: { classNode: SyntaxNode; propertyNodes: SyntaxNode[] } | null,
    fileContent: string,
    anchors: string[],
    maxLines: number,
  ): string {
    const lines: { text: string; anchorIdx: number }[] = [];
    const fileLines = fileContent.split(/\r?\n/);

    for (const imp of imports) {
      const start = imp.startPosition.row;
      const end = imp.endPosition.row;
      for (let i = start; i <= end; i++) {
        if (fileLines[i] !== undefined) lines.push({ text: fileLines[i], anchorIdx: i });
      }
    }

    if (classContext) {
      const { classNode, propertyNodes } = classContext;
      const classStart = classNode.startPosition.row;
      if (fileLines[classStart] !== undefined) lines.push({ text: fileLines[classStart], anchorIdx: classStart });

      for (const prop of propertyNodes) {
        const start = prop.startPosition.row;
        const end = prop.endPosition.row;
        for (let i = start; i <= end; i++) {
          if (fileLines[i] !== undefined) lines.push({ text: fileLines[i], anchorIdx: i });
        }
      }
    }

    const sortedLines = lines
      .sort((a, b) => a.anchorIdx - b.anchorIdx)
      .filter((line, index, self) => index === 0 || line.anchorIdx !== self[index - 1].anchorIdx);

    if (sortedLines.length === 0) return "";

    let result = "";
    let lastLineIdx = -1;
    let linesCount = 0;

    for (const line of sortedLines) {
      if (linesCount >= maxLines) break;
      if (lastLineIdx !== -1 && line.anchorIdx > lastLineIdx + 1) result += "...\n";
      result += `${formatLineWithHash(line.text, anchors[line.anchorIdx])}\n`;
      lastLineIdx = line.anchorIdx;
      linesCount++;
    }

    if (result && lastLineIdx !== -1) result += "...\n";
    return result;
  }
}
