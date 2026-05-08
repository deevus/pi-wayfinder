/*
- class, interface, enum, trait declarations
- function and method definitions
- namespace declarations
- doc comments
*/
export default `
;; Namespaces
(
  (comment)* @doc
  .
  (namespace_definition
    name: (namespace_name) @name.definition.module) @definition.module
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.module)
)

;; Classes
(
  (comment)* @doc
  .
  (class_declaration
    name: (name) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Interfaces
(
  (comment)* @doc
  .
  (interface_declaration
    name: (name) @name.definition.interface) @definition.interface
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.interface)
)

;; Traits (Interfaces)
(
  (comment)* @doc
  .
  (trait_declaration
    name: (name) @name.definition.interface) @definition.interface
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.interface)
)

;; Enums
(
  (comment)* @doc
  .
  (enum_declaration
    name: (name) @name.definition.enum) @definition.enum
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.enum)
)

;; Functions
(
  (comment)* @doc
  .
  (function_definition
    name: (name) @name.definition.function) @definition.function
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.function)
)

;; Methods
(
  (comment)* @doc
  .
  (method_declaration
    name: (name) @name.definition.method) @definition.method
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.method)
)

;; Anonymous functions assigned to variables
(assignment_expression
  left: (variable_name (name) @name.definition.function)
  right: [(anonymous_function_creation_expression) (arrow_function)]) @definition.function

;; References
(name) @name.reference
(variable_name) @name.reference
`
