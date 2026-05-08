/*
- struct, union, enum declarations
- function definitions and declarations
- typedef declarations
- doc comments
*/
export default `
;; Structs (Classes)
(
  (comment)* @doc
  .
  (struct_specifier
    name: (type_identifier) @name.definition.class
    body: (_)) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Unions (Classes)
(
  (comment)* @doc
  .
  (declaration
    type: (union_specifier
      name: (type_identifier) @name.definition.class)) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Enums (Classes)
(
  (comment)* @doc
  .
  (enum_specifier
    name: (type_identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Functions
(
  (comment)* @doc
  .
  (function_definition
    declarator: [
      (function_declarator
        declarator: (identifier) @name.definition.function)
      (pointer_declarator
        declarator: (function_declarator
          declarator: (identifier) @name.definition.function))
    ]
  ) @definition.function
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.function)
)

;; Function Prototypes
(
  (comment)* @doc
  .
  (declaration
    declarator: [
      (function_declarator
        declarator: (identifier) @name.definition.function)
      (pointer_declarator
        declarator: (function_declarator
          declarator: (identifier) @name.definition.function))
    ]
  ) @definition.function
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.function)
)

;; Typedefs
(
  (comment)* @doc
  .
  (type_definition
    declarator: (type_identifier) @name.definition.type) @definition.type
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.type)
)

;; References
(identifier) @name.reference
(type_identifier) @name.reference
`
