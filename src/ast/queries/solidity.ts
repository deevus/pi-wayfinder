export default `
(contract_declaration
  name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(modifier_definition
  name: (identifier) @name.definition.function) @definition.function

(event_definition
  name: (identifier) @name.definition.type) @definition.type

(identifier) @name.reference
`
