import { Type } from "typebox";

export const ReadFileSchema = Type.Object({
  paths: Type.Array(Type.String(), { description: "Relative or absolute file paths to read" }),
  start_line: Type.Optional(Type.Number({ description: "1-indexed start line" })),
  end_line: Type.Optional(Type.Number({ description: "1-indexed end line, inclusive" }))
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
