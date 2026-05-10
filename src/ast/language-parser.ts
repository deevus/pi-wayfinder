import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";
import {
  bashQuery,
  cppQuery,
  cQuery,
  csharpQuery,
  cssQuery,
  elispQuery,
  elixirQuery,
  goQuery,
  htmlQuery,
  javaQuery,
  javascriptQuery,
  jsonQuery,
  kotlinQuery,
  luaQuery,
  objcQuery,
  ocamlQuery,
  phpQuery,
  pythonQuery,
  rescriptQuery,
  rubyQuery,
  rustQuery,
  scalaQuery,
  solidityQuery,
  swiftQuery,
  systemrdlQuery,
  tlaplusQuery,
  tomlQuery,
  typescriptQuery,
  vueQuery,
  zigQuery,
} from "./queries/index.js";

export interface LanguageParser {
  [key: string]: { parser: Parser; query: Parser.Query };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const realDirname = fs.realpathSync(__dirname);

function uniqueExistingOrder(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

async function loadLanguage(langName: string): Promise<Parser.Language> {
  const wasmName = `tree-sitter-${langName}.wasm`;
  const searchPaths = uniqueExistingOrder([
    path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmName),
    path.join(__dirname, "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmName),
    path.join(realDirname, "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmName),
  ]);

  for (const wasmPath of searchPaths) {
    try {
      return await Parser.Language.load(wasmPath);
    } catch {
      // Try next location.
    }
  }
  throw new Error(`Could not find WASM for language: ${langName}`);
}

let isParserInitialized = false;
let initializationPromise: Promise<void> | null = null;
const languageCache = new Map<string, Parser.Language>();
const queryCache = new Map<string, Parser.Query>();

async function initializeParser(): Promise<void> {
  if (isParserInitialized) return;
  if (!initializationPromise) {
    initializationPromise = Parser.init({
      locateFile(scriptName: string) {
        const localPath = path.join(__dirname, scriptName);
        if (fs.existsSync(localPath)) return localPath;
        const realLocalPath = path.join(realDirname, scriptName);
        if (fs.existsSync(realLocalPath)) return realLocalPath;
        const packageLocalPath = path.join(__dirname, "..", "..", "node_modules", "web-tree-sitter", scriptName);
        if (fs.existsSync(packageLocalPath)) return packageLocalPath;
        const realPackageLocalPath = path.join(realDirname, "..", "..", "node_modules", "web-tree-sitter", scriptName);
        if (fs.existsSync(realPackageLocalPath)) return realPackageLocalPath;
        return path.join(process.cwd(), "node_modules", "web-tree-sitter", scriptName);
      },
    }).then(() => {
      isParserInitialized = true;
    });
  }
  return initializationPromise;
}

export function languageForExtension(ext: string): { langName: string; queryText: string } {
  switch (ext) {
    case "bash":
    case "sh":
    case "zsh":
      return { langName: "bash", queryText: bashQuery };
    case "js":
    case "jsx":
      return { langName: "javascript", queryText: javascriptQuery };
    case "ts":
      return { langName: "typescript", queryText: typescriptQuery };
    case "tsx":
      return { langName: "tsx", queryText: typescriptQuery };
    case "py":
      return { langName: "python", queryText: pythonQuery };
    case "rs":
      return { langName: "rust", queryText: rustQuery };
    case "go":
      return { langName: "go", queryText: goQuery };
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
    case "hxx":
      return { langName: "cpp", queryText: cppQuery };
    case "c":
    case "h":
      return { langName: "c", queryText: cQuery };
    case "cs":
      return { langName: "c_sharp", queryText: csharpQuery };
    case "css":
      return { langName: "css", queryText: cssQuery };
    case "el":
    case "elisp":
      return { langName: "elisp", queryText: elispQuery };
    case "ex":
    case "exs":
      return { langName: "elixir", queryText: elixirQuery };
    case "html":
    case "htm":
      return { langName: "html", queryText: htmlQuery };
    case "rb":
      return { langName: "ruby", queryText: rubyQuery };
    case "java":
      return { langName: "java", queryText: javaQuery };
    case "json":
      return { langName: "json", queryText: jsonQuery };
    case "php":
      return { langName: "php", queryText: phpQuery };
    case "swift":
      return { langName: "swift", queryText: swiftQuery };
    case "kt":
    case "kts":
      return { langName: "kotlin", queryText: kotlinQuery };
    case "lua":
      return { langName: "lua", queryText: luaQuery };
    case "m":
    case "mm":
      return { langName: "objc", queryText: objcQuery };
    case "ml":
    case "mli":
      return { langName: "ocaml", queryText: ocamlQuery };
    case "res":
    case "resi":
      return { langName: "rescript", queryText: rescriptQuery };
    case "scala":
    case "sc":
      return { langName: "scala", queryText: scalaQuery };
    case "sol":
      return { langName: "solidity", queryText: solidityQuery };
    case "rdl":
      return { langName: "systemrdl", queryText: systemrdlQuery };
    case "tla":
      return { langName: "tlaplus", queryText: tlaplusQuery };
    case "toml":
      return { langName: "toml", queryText: tomlQuery };
    case "vue":
      return { langName: "vue", queryText: vueQuery };
    case "zig":
      return { langName: "zig", queryText: zigQuery };
    default:
      throw new Error(`Unsupported language: ${ext}`);
  }
}

export async function loadRequiredLanguageParsers(filesToParse: string[]): Promise<LanguageParser> {
  await initializeParser();
  const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)));
  const parsers: LanguageParser = {};

  for (const ext of extensionsToLoad) {
    const { langName, queryText } = languageForExtension(ext);
    let language = languageCache.get(langName);
    if (!language) {
      language = await loadLanguage(langName);
      languageCache.set(langName, language);
    }

    const queryCacheKey = `${langName}:${queryText}`;
    let query = queryCache.get(queryCacheKey);
    if (!query) {
      query = language.query(queryText);
      queryCache.set(queryCacheKey, query);
    }

    const parser = new Parser();
    parser.setLanguage(language);
    parsers[ext] = { parser, query };
  }

  return parsers;
}
