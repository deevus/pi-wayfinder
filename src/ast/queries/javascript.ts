/*
- class definitions
- method definitions
- named function declarations
- arrow functions and function expressions assigned to variables
- doc comments
*/
export default `
(
  (comment)* @doc
  .
  (method_definition
    name: [(property_identifier) (identifier)] @name.definition.method) @definition.method
  (#not-eq? @name.definition.method "constructor")
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.method)
)

(
  (comment)* @doc
  .
  [
    (class
      name: (_) @name.definition.class)
    (class_declaration
      name: (_) @name.definition.class)
  ] @definition.class
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.class)
)

(
  (comment)* @doc
  .
  [
    (function_declaration
      name: (identifier) @name.definition.function)
    (generator_function_declaration
      name: (identifier) @name.definition.function)
  ] @definition.function
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
  (field_definition
    name: [(property_identifier) (identifier)] @name.definition.method
    value: [(arrow_function) (function_expression)]) @definition.method
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.method)
)
;; Variable declarations with arrow functions
(
  (comment)* @doc
  .
  [
    (lexical_declaration
      (variable_declarator
        name: (identifier) @name.definition.function
        value: [(arrow_function) (function_expression)]))
    (variable_declaration
      (variable_declarator
        name: (identifier) @name.definition.function
        value: [(arrow_function) (function_expression)]))
  ] @definition.function
  (#strip! @doc "^[\\\\s\\\\*/]+|[\\\\s\\\\*/]+$")
  (#select-adjacent! @doc @definition.function)
)

;; References
(identifier) @name.reference
(property_identifier) @name.reference
`
