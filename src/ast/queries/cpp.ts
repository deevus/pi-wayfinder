/*
- struct, union, enum, class declarations
- namespace declarations
- function and method definitions/declarations
- field declarations
- typedef declarations
- doc comments
*/
export default `
;; Namespaces
(
  (comment)* @doc
  .
  (namespace_definition
    name: [(namespace_identifier) (nested_namespace_specifier)] @name.definition.module) @definition.module
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.module)
)

;; Classes
(
  (comment)* @doc
  .
  (class_specifier
    name: [(type_identifier) (qualified_identifier)] @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Structs (Classes)
(
  (comment)* @doc
  .
  (struct_specifier
    name: [(type_identifier) (qualified_identifier)] @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Enums (Classes)
(
  (comment)* @doc
  .
  (enum_specifier
    name: [(type_identifier) (qualified_identifier)] @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Unions (Classes)
(
  (comment)* @doc
  .
  (union_specifier
    name: [(type_identifier) (qualified_identifier)] @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Functions and Methods
(
  (comment)* @doc
  .
  (function_definition
    declarator: [
      (function_declarator
        declarator: [
          (identifier) @name.definition.function
          (field_identifier) @name.definition.method
          (qualified_identifier) @name.definition.method
          (destructor_name) @name.definition.method
          (operator_name) @name.definition.method
        ]
      )
      (pointer_declarator
        declarator: (function_declarator
          declarator: [
            (identifier) @name.definition.function
            (field_identifier) @name.definition.method
            (qualified_identifier) @name.definition.method
            (destructor_name) @name.definition.method
            (operator_name) @name.definition.method
          ]
        )
      )
      (reference_declarator
        (function_declarator
          declarator: [
            (identifier) @name.definition.function
            (field_identifier) @name.definition.method
            (qualified_identifier) @name.definition.method
            (destructor_name) @name.definition.method
            (operator_name) @name.definition.method
          ]
        )
      )
    ]
  ) @definition.symbol
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.symbol)
)

;; Map @definition.symbol to specific kinds
((function_definition declarator: [
  (function_declarator declarator: (identifier))
  (pointer_declarator declarator: (function_declarator declarator: (identifier)))
  (reference_declarator (function_declarator declarator: (identifier)))
]) @definition.function)

((function_definition declarator: [
  (function_declarator declarator: [(field_identifier) (qualified_identifier) (destructor_name) (operator_name)])
  (pointer_declarator declarator: (function_declarator declarator: [(field_identifier) (qualified_identifier) (destructor_name) (operator_name)]))
  (reference_declarator (function_declarator declarator: [(field_identifier) (qualified_identifier) (destructor_name) (operator_name)]))
]) @definition.method)

;; Function Prototypes
(
  (comment)* @doc
  .
  (declaration
    (function_declarator
      declarator: [
        (identifier) @name.definition.function
        (field_identifier) @name.definition.method
        (qualified_identifier) @name.definition.method
      ]
    )
  ) @definition.symbol
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.symbol)
)

;; Map prototypes to specific kinds
((declaration (function_declarator declarator: (identifier))) @definition.function)
((declaration (function_declarator declarator: (field_identifier))) @definition.method)
((declaration (function_declarator declarator: (qualified_identifier))) @definition.method)

;; Lambdas in field initializers (dispatch tables)
(initializer_pair
  designator: (field_designator (field_identifier) @name.definition.method)
  value: (lambda_expression)) @definition.method

;; Lambdas assigned to variables
(declaration
  declarator: (init_declarator
    declarator: (identifier) @name.definition.function
    value: (lambda_expression))) @definition.function

;; Typedefs
(
  (comment)* @doc
  .
  (type_definition
    declarator: [
      (type_identifier) @name.definition.type
      (identifier) @name.definition.type
    ]
  ) @definition.type
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.type)
)

;; References
(identifier) @name.reference
(field_identifier) @name.reference
(type_identifier) @name.reference
(namespace_identifier) @name.reference
`
