export default `
(class_interface
  (identifier) @name.definition.class) @definition.class

(class_implementation
  (identifier) @name.definition.class) @definition.class

(method_declaration
  (identifier) @name.definition.method) @definition.method

(method_definition
  (identifier) @name.definition.method) @definition.method

(identifier) @name.reference
`
