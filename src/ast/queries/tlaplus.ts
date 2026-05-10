export default `
(module
  name: (identifier) @name.definition.module) @definition.module

(operator_definition
  name: (identifier) @name.definition.function) @definition.function

(variable_declaration
  (identifier) @name.definition.type) @definition.type

(identifier_ref) @name.reference
(identifier) @name.reference
`
