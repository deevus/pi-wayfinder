export default `
(local_function_definition_statement
  name: (identifier) @name.definition.function) @definition.function

(function_definition_statement
  name: (variable
    field: (identifier) @name.definition.function)) @definition.function

(local_variable_declaration
  (variable_list (variable name: (identifier) @name.definition.function))
  (expression_list value: (function_definition))) @definition.function

(identifier) @name.reference
`
