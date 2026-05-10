export default `
(pair
  (bare_key) @name.definition.type) @definition.type

(table
  (dotted_key (bare_key) @name.definition.module)) @definition.module

(bare_key) @name.reference
`
