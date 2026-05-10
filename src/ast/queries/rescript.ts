export default `
(let_declaration
  (let_binding
    pattern: (value_identifier) @name.definition.function)) @definition.function

(type_declaration
  (type_binding
    name: (type_identifier) @name.definition.type)) @definition.type

(module_declaration
  (module_binding
    name: (module_identifier) @name.definition.module)) @definition.module

(value_identifier) @name.reference
(type_identifier) @name.reference
(module_identifier) @name.reference
(property_identifier) @name.reference
`
