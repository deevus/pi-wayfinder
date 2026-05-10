export default `
(function_definition
  name: (word) @name.definition.function) @definition.function

(command
  name: (command_name (word) @name.reference))

(word) @name.reference
`
