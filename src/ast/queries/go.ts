/*
- function declarations (with associated comments)
- method declarations (with associated comments)
- type specifications (structs, interfaces, aliases)
- package declarations
*/
export default `
;; Package
(
  (comment)* @doc
  .
  (package_clause
    (package_identifier) @name.definition.module) @definition.module
  (#strip! @doc "^//\\\\s*")
  (#select-adjacent! @doc @definition.module)
)

;; Functions
(
  (comment)* @doc
  .
  (function_declaration
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^//\\\\s*")
  (#select-adjacent! @doc @definition.function)
)

;; Methods
(
  (comment)* @doc
  .
  (method_declaration
    name: [(field_identifier) (identifier)] @name.definition.method) @definition.method
  (#strip! @doc "^//\\\\s*")
  (#select-adjacent! @doc @definition.method)
)

;; Structs (Classes)
(
  (comment)* @doc
  .
  (type_spec
    name: (type_identifier) @name.definition.class
    type: (struct_type)) @definition.class
  (#strip! @doc "^//\\\\s*")
  (#select-adjacent! @doc @definition.class)
)

;; Interfaces
(
  (comment)* @doc
  .
  (type_spec
    name: (type_identifier) @name.definition.interface
    type: (interface_type)) @definition.interface
  (#strip! @doc "^//\\\\s*")
  (#select-adjacent! @doc @definition.interface)
)

;; Type Aliases
(
  (comment)* @doc
  .
  (type_spec
    name: (type_identifier) @name.definition.type) @definition.type
  (#strip! @doc "^//\\\\s*")
  (#select-adjacent! @doc @definition.type)
)

;; Func literals in keyed elements (dispatch tables)
(keyed_element
  (literal_element) @name.definition.method
  (literal_element (func_literal))) @definition.method

;; Short variable declarations for functions
(short_var_declaration
  left: (expression_list (identifier) @name.definition.function)
  right: (expression_list (func_literal))) @definition.function

;; References
(identifier) @name.reference
(field_identifier) @name.reference
(type_identifier) @name.reference
(package_identifier) @name.reference
`
