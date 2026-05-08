/*
- class, interface, enum, record declarations
- annotation type declarations
- method definitions
- package declarations
- doc comments
*/
export default `
;; Package
(
  [(line_comment) (block_comment)]* @doc
  .
  (package_declaration
    (scoped_identifier) @name.definition.module) @definition.module
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.module)
)

;; Classes
(
  [(line_comment) (block_comment)]* @doc
  .
  (class_declaration
    name: (identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Interfaces
(
  [(line_comment) (block_comment)]* @doc
  .
  (interface_declaration
    name: (identifier) @name.definition.interface) @definition.interface
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.interface)
)

;; Enums
(
  [(line_comment) (block_comment)]* @doc
  .
  (enum_declaration
    name: (identifier) @name.definition.enum) @definition.enum
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.enum)
)

;; Records (Classes)
(
  [(line_comment) (block_comment)]* @doc
  .
  (record_declaration
    name: (identifier) @name.definition.class) @definition.class
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.class)
)

;; Annotation Types (Interfaces)
(
  [(line_comment) (block_comment)]* @doc
  .
  (annotation_type_declaration
    name: (identifier) @name.definition.interface) @definition.interface
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.interface)
)

;; Methods
(
  [(line_comment) (block_comment)]* @doc
  .
  (method_declaration
    name: (identifier) @name.definition.method) @definition.method
  (#strip! @doc "^[/\\\\*!\\\\s]+|[\\\\*!\\\\s]+$")
  (#select-adjacent! @doc @definition.method)
)

;; References
(identifier) @name.reference
(type_identifier) @name.reference
`
