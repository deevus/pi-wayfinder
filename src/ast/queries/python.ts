/*
- class definitions
- function definitions
- method definitions
- decorated definitions
- docstrings
- type aliases
- enums
*/
export default `
;; Classes
(class_definition
  name: (identifier) @name.definition.class
  body: (block . (expression_statement (string) @doc)?)) @definition.class

;; Methods (functions inside classes)
(class_definition
  body: (block
    (function_definition
      name: (identifier) @name.definition.method
      body: (block . (expression_statement (string) @doc)?)) @definition.method))

;; Top-level Functions
(function_definition
  name: (identifier) @name.definition.function
  body: (block . (expression_statement (string) @doc)?)) @definition.function

;; Decorated Definitions
(decorated_definition
  definition: [
    (class_definition
      name: (identifier) @name.definition.class
      body: (block . (expression_statement (string) @doc)?))
    (function_definition
      name: (identifier) @name.definition.function
      body: (block . (expression_statement (string) @doc)?))
  ]) @definition.symbol

;; Map @definition.symbol to specific kinds
((decorated_definition definition: (class_definition)) @definition.class)
((decorated_definition definition: (function_definition)) @definition.function)

;; Lambdas assigned to variables
(assignment
  left: (identifier) @name.definition.function
  right: (lambda)) @definition.function

;; Lambdas in dictionaries (often used for dispatch)
(pair
  key: [(string) (identifier)] @name.definition.method
  value: (lambda)) @definition.method

;; Legacy Type Aliases (rough heuristic: Uppercase name assigned a type-like expression)
(assignment
  left: (identifier) @name.definition.type
  (#match? @name.definition.type "^[A-Z][a-zA-Z0-9_]*$")
  right: [
    (subscript)
    (identifier)
  ]) @definition.type

;; References
(identifier) @name.reference
(attribute attribute: (identifier) @name.reference)
(keyword_argument name: (identifier) @name.reference)
`
