export default `
(call
  target: (identifier) @_defmodule
  (arguments (alias) @name.definition.module)
  (#eq? @_defmodule "defmodule")) @definition.module

(call
  target: (identifier) @_def
  (arguments (call target: (identifier) @name.definition.function))
  (#eq? @_def "def")) @definition.function

(call
  target: (identifier) @_defp
  (arguments (call target: (identifier) @name.definition.function))
  (#eq? @_defp "defp")) @definition.function

(identifier) @name.reference
(alias) @name.reference
`
