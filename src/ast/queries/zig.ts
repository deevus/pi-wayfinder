export default `
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(variable_declaration
  (identifier) @name.definition.type
  (struct_declaration)) @definition.type

(variable_declaration
  (identifier) @name.definition.type
  (enum_declaration)) @definition.type

(identifier) @name.reference
`
