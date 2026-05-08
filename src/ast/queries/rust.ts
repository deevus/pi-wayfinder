/*
- struct, enum, trait, type declarations
- function and method definitions
- module declarations
- doc comments
*/
export default `
;; Modules
(
  [(line_comment) (block_comment)]* @doc
  .
  (mod_item
    name: (identifier) @name.definition.module) @definition.module
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.module)
)

;; Structs (Classes)
(
  [(line_comment) (block_comment)]* @doc
  .
  (struct_item
    name: (type_identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Enums (Classes)
(
  [(line_comment) (block_comment)]* @doc
  .
  (enum_item
    name: (type_identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Traits (Interfaces)
(
  [(line_comment) (block_comment)]* @doc
  .
  (trait_item
    name: (type_identifier) @name.definition.interface) @definition.interface
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.interface)
)

;; Type Aliases
(
  [(line_comment) (block_comment)]* @doc
  .
  (type_item
    name: (type_identifier) @name.definition.type) @definition.type
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.type)
)

;; Functions
(
  [(line_comment) (block_comment)]* @doc
  .
  (function_item
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.function)
)

;; Methods (functions inside impl blocks)
(impl_item
  body: (declaration_list
    (function_item
      name: (identifier) @name.definition.method) @definition.method))

;; Closures assigned to variables
(let_declaration
  pattern: (identifier) @name.definition.function
  value: (closure_expression)) @definition.function

;; Closures in field initializers (dispatch tables)
(field_initializer
  name: (field_identifier) @name.definition.method
  value: (closure_expression)) @definition.method

;; References
(identifier) @name.reference
(type_identifier) @name.reference
(field_identifier) @name.reference
`
