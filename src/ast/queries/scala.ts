export default `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(object_definition
  name: (identifier) @name.definition.module) @definition.module

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(identifier) @name.reference
(type_identifier) @name.reference
`
