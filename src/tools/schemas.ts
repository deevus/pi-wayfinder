import { Type } from "typebox";

export const ReadFileSchema = Type.Object({
  paths: Type.Array(Type.String(), { description: "Relative or absolute file paths to read" }),
  start_line: Type.Optional(Type.Integer({ minimum: 1, description: "1-indexed start line" })),
  end_line: Type.Optional(Type.Integer({ minimum: 1, description: "1-indexed end line, inclusive" }))
});

export const EditFileSchema = Type.Object({
  files: Type.Array(Type.Object({
    path: Type.String(),
    edits: Type.Array(Type.Object({
      edit_type: Type.Union([
        Type.Literal("replace"),
        Type.Literal("insert_after"),
        Type.Literal("insert_before")
      ]),
      anchor: Type.String(),
      end_anchor: Type.Optional(Type.String()),
      text: Type.String()
    }))
  }))
});

export const GetFileSkeletonSchema = Type.Object({
  paths: Type.Array(Type.String())
});

export const GetFunctionSchema = Type.Object({
  paths: Type.Array(Type.String()),
  function_names: Type.Array(Type.String())
});

export const ReplaceSymbolSchema = Type.Object({
  replacements: Type.Array(Type.Object({
    path: Type.String({ description: "Relative or absolute source file path" }),
    symbol: Type.String({ description: "Dot-separated symbol path or suffix to replace" }),
    text: Type.String({ description: "Complete replacement source for the symbol" }),
    type: Type.Optional(Type.String({ description: "Optional symbol type such as function, method, class, or interface" }))
  }))
});


export const FindSymbolReferencesSchema = Type.Object({
  paths: Type.Array(Type.String({ description: "Relative or absolute files/directories to search" })),
  symbols: Type.Array(Type.String({ description: "Exact symbol names to find" })),
  find_type: Type.Optional(Type.Union([
    Type.Literal("definition"),
    Type.Literal("reference"),
    Type.Literal("both")
  ]))
});

export const RenameSymbolSchema = Type.Object({
  paths: Type.Array(Type.String({ description: "Relative or absolute files/directories to rename within" })),
  existing_symbol: Type.String({ description: "Exact symbol text to rename" }),
  new_symbol: Type.String({ description: "Replacement symbol text" })
});
