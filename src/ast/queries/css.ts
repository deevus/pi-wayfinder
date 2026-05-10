export default `
(rule_set
  (selectors
    (class_selector (class_name) @name.definition.class))) @definition.class

(rule_set
  (selectors
    (id_selector (id_name) @name.definition.type))) @definition.type

(property_name) @name.reference
(class_name) @name.reference
(id_name) @name.reference
`
