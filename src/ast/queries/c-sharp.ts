/*
- class, interface, enum, struct, record declarations
- delegate declarations
- method definitions
- namespace declarations
- doc comments
*/
export default `
;; Namespaces
(
  (comment)* @doc
  .
  (namespace_declaration
    name: [(identifier) (qualified_name)] @name.definition.module) @definition.module
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.module)
)

;; Classes
(
  (comment)* @doc
  .
  (class_declaration
    name: (identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Interfaces
(
  (comment)* @doc
  .
  (interface_declaration
    name: (identifier) @name.definition.interface) @definition.interface
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.interface)
)

;; Enums
(
  (comment)* @doc
  .
  (enum_declaration
    name: (identifier) @name.definition.enum) @definition.enum
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.enum)
)

;; Structs (Classes)
(
  (comment)* @doc
  .
  (struct_declaration
    name: (identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Delegates (Functions)
(
  (comment)* @doc
  .
  (delegate_declaration
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.function)
)

;; Records (Classes)
(
  (comment)* @doc
  .
  (record_declaration
    name: (identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Methods
(
  (comment)* @doc
  .
  (method_declaration
    name: (identifier) @name.definition.method) @definition.method
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.method)
)

;; Lambdas assigned to variables
(variable_declarator
  (identifier) @name.definition.function
  (equals_value_clause (lambda_expression))) @definition.function

;; References
(identifier) @name.reference
`
