/*
- function signatures and declarations
- method signatures and definitions
- abstract method signatures
- class declarations (including abstract classes)
- module/namespace declarations
- interface declarations
- enum declarations
- type alias declarations
- variable declarations with arrow functions
*/
export default `
(
  (comment)* @doc
  .
  (function_signature
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.function)
)

(
  (comment)* @doc
  .
  (function_declaration
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.function)
)

(
  (comment)* @doc
  .
  (method_signature
    name: [(property_identifier) (identifier)] @name.definition.method) @definition.method
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.method)
)

(
  (comment)* @doc
  .
  (method_definition
    name: [(property_identifier) (identifier)] @name.definition.method) @definition.method
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.method)
)

(
  (comment)* @doc
  .
  (abstract_method_signature
    name: [(property_identifier) (identifier)] @name.definition.method) @definition.method
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.method)
)

(
  (comment)* @doc
  .
  (abstract_class_declaration
    name: (type_identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.class)
)

(
  (comment)* @doc
  .
  (class_declaration
    name: (type_identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.class)
)

(
  (comment)* @doc
  .
  (module
    name: [(identifier) (string)] @name.definition.module) @definition.module
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.module)
)

(
  (comment)* @doc
  .
  (interface_declaration
    name: (type_identifier) @name.definition.interface) @definition.interface
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.interface)
)

(
  (comment)* @doc
  .
  (enum_declaration
    name: (identifier) @name.definition.enum) @definition.enum
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.enum)
)

(
  (comment)* @doc
  .
  (type_alias_declaration
    name: (type_identifier) @name.definition.type) @definition.type
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.type)
)

;; Variable declarations with arrow functions
(
  (comment)* @doc
  .
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name.definition.function
      value: [(arrow_function) (function_expression)])) @definition.function
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.function)
)

(
  (comment)* @doc
  .
  (variable_declaration
    (variable_declarator
      name: (identifier) @name.definition.function
      value: [(arrow_function) (function_expression)])) @definition.function
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.function)
)

;; Object properties with arrow functions
(
  (comment)* @doc
  .
  (pair
    key: [(property_identifier) (identifier)] @name.definition.method
    value: [(arrow_function) (function_expression)]) @definition.method
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.method)
)
;; Class properties with arrow functions
(
  (comment)* @doc
  .
  (public_field_definition
    name: [(property_identifier) (identifier)] @name.definition.method
    value: [(arrow_function) (function_expression)]) @definition.method
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.method)
)
;; References
(identifier) @name.reference
(property_identifier) @name.reference
(type_identifier) @name.reference
`
