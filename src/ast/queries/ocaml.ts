export default `
(value_definition
  (let_binding
    pattern: (value_name) @name.definition.function)) @definition.function

(type_definition
  (type_binding
    name: (type_constructor) @name.definition.type)) @definition.type

(module_definition
  (module_binding
    name: (module_name) @name.definition.module)) @definition.module

(value_name) @name.reference
(type_constructor) @name.reference
(module_name) @name.reference
`
