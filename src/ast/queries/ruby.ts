/*
- method definitions (including singleton methods and aliases)
- class definitions (including singleton classes)
- module definitions
- doc comments
*/
export default `
;; Methods
(
  (comment)* @doc
  .
  [
    (method
      name: (_) @name.definition.method) @definition.method
    (singleton_method
      name: (_) @name.definition.method) @definition.method
  ]
  (#strip! @doc "^#\\\\s*")
  (#select-adjacent! @doc @definition.method)
)

;; Method Aliases
(alias
  name: (_) @name.definition.method) @definition.method

;; Classes
(
  (comment)* @doc
  .
  [
    (class
      name: [
        (constant) @name.definition.class
        (scope_resolution name: (_) @name.definition.class)
      ]) @definition.class
    (singleton_class
      value: [
        (constant) @name.definition.class
        (scope_resolution name: (_) @name.definition.class)
      ]) @definition.class
  ]
  (#strip! @doc "^#\\\\s*")
  (#select-adjacent! @doc @definition.class)
)

;; Modules
(
  (comment)* @doc
  .
  (module
    name: [
      (constant) @name.definition.module
      (scope_resolution name: (_) @name.definition.module)
    ]) @definition.module
  (#strip! @doc "^#\\\\s*")
  (#select-adjacent! @doc @definition.module)
)

;; Lambdas/Procs assigned to variables
(assignment
  left: (identifier) @name.definition.function
  right: (lambda)) @definition.function

;; Lambdas/Procs in pairs (dispatch tables)
(pair
  key: (simple_symbol) @name.definition.method
  value: (lambda)) @definition.method

;; References
(identifier) @name.reference
(constant) @name.reference
(simple_symbol) @name.reference
`
