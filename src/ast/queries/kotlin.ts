/*
- class, interface, enum, object declarations
- function declarations
- property declarations
- type alias declarations
- package declarations
- doc comments
*/
export default `
;; Package
(
  [(line_comment) (multiline_comment)]* @doc
  .
  (package_header
    (identifier) @name.definition.module) @definition.module
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.module)
)

;; Classes
(
  [(line_comment) (multiline_comment)]* @doc
  .
  (class_declaration
    (type_identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Interfaces
(
  [(line_comment) (multiline_comment)]* @doc
  .
  ((class_declaration
    "interface"
    (type_identifier) @name.definition.interface)) @definition.interface
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.interface)
)

;; Enums
(
  [(line_comment) (multiline_comment)]* @doc
  .
  ((class_declaration
    "enum"
    (type_identifier) @name.definition.enum)) @definition.enum
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.enum)
)

;; Objects
(
  [(line_comment) (multiline_comment)]* @doc
  .
  (object_declaration
    (type_identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Functions
(
  [(line_comment) (multiline_comment)]* @doc
  .
  (function_declaration
    (simple_identifier) @name.definition.function) @definition.function
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.function)
)

;; Methods (functions inside classes/objects)
(class_body
  (function_declaration
    (simple_identifier) @name.definition.method) @definition.method)

;; Properties
(
  [(line_comment) (multiline_comment)]* @doc
  .
  (property_declaration
    (simple_identifier) @name.definition.property) @definition.property
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.property)
)

;; Type Aliases
(
  [(line_comment) (multiline_comment)]* @doc
  .
  (type_alias
    (type_identifier) @name.definition.type) @definition.type
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.type)
)

;; References
(simple_identifier) @name.reference
(type_identifier) @name.reference
`
