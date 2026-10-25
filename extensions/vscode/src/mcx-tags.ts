/**
 * Tag / attribute tables for the MCX DSL.
 *
 * Everything here is mirrored from `@mbler/mcx-core`, which is the only
 * authority on what a `.mcx` file actually accepts:
 *
 * - `compile-mcx/types.ts`               component group -> child tag map
 * - `compile-mcx/compiler/compileMCX.ts`  root tags, `id` on component children
 * - `transforms/transform/layout.ts`      `UI_TAGS` / `FORM_TAGS` / `COMMON_ATTRS` / `TAG_ATTRS`
 * - `transforms/main.ts`                  `setup` on `<Ui>` / `<Form>`
 * - `transforms/utils.ts`                 `tick` on `<Event>`
 *
 * The tables drive both attribute completions and hover docs, so they must not
 * drift from the compiler. Note the compiler validates almost nothing: an
 * unknown attribute on an unlisted tag is silently forwarded, which is exactly
 * why completion should offer the *known* set instead of everything.
 */

/** Root tags recognised at the top level of a file. */
export const ROOT_TAGS = ['script', 'Event', 'Ui', 'Form', 'Component', 'App']

/** Root tags the compiler actually transforms (`App` has no transform). */
export const SUGGESTED_ROOT_TAGS = ['script', 'Event', 'Ui', 'Form', 'Component']

/** `<Component>` group tag -> the single child tag it accepts. */
export const COMPONENT_GROUPS: Record<string, string> = {
  items: 'item',
  blocks: 'block',
  entities: 'entity',
  recipes: 'recipe',
  loot_tables: 'lootTable',
  spawn_rules: 'spawnRule',
  trade_tables: 'tradeTable',
  features: 'feature',
  feature_rules: 'featureRule',
  itemCatalog: 'itemCatalog',
  ui: 'ui',
  client_entities: 'clientEntity',
  attachables: 'attachable',
}

/** Groups whose files are written to the resource pack, not the behavior pack. */
export const RESOURCE_PACK_GROUPS = [
  'ui',
  'client_entities',
  'attachables',
]

/** Leaf elements accepted inside `<Ui>`. */
export const UI_TAGS = [
  'input',
  'textField',
  'toggle',
  'dropdown',
  'slider',
  'button',
  'label',
  'body',
  'header',
  'title',
  'divider',
  'spacer',
  'close-button',
]

/** Leaf elements accepted inside `<Form>`. */
export const FORM_TAGS = [
  'input',
  'dropdown',
  'submit',
  'toggle',
  'slider',
  'button',
  'button-m',
  'body',
  'divider',
  'title',
]

/** `COMMON_ATTRS` — accepted by every `<Ui>` / `<Form>` leaf. */
const LAYOUT_COMMON_ATTRS = [
  'id',
  'for',
  'if',
  'tip',
  'disabled',
  'visible',
  'description',
  ':id',
  ':for',
  ':if',
  ':tip',
  ':disabled',
  ':visible',
  ':description',
]

/** `TAG_ATTRS` — per-element extras on top of `LAYOUT_COMMON_ATTRS`. */
const LAYOUT_EXTRA_ATTRS: Record<string, string[]> = {
  input: ['placeholderText', 'default', 'value', ':placeholderText', ':default', ':value'],
  textField: ['placeholderText', 'default', 'value', ':placeholderText', ':default', ':value'],
  toggle: ['default', 'value', ':default', ':value'],
  dropdown: ['default', 'value', 'option', ':default', ':value', ':option'],
  slider: ['default', 'value', 'min', 'max', ':default', ':value', ':min', ':max'],
  button: ['click', 'img', ':click', ':img'],
  submit: ['click', ':click'],
  'button-m': ['click', ':click'],
}

/** Tags that contain other tags (used for the "where am I" completion logic). */
export const CONTAINER_TAGS = new Set([
  'Component',
  'Ui',
  'Form',
  ...Object.keys(COMPONENT_GROUPS),
])

const REQUIRED_ID_ONLY: Record<string, string[]> = {
  item: ['id'],
  block: ['id'],
  entity: ['id'],
  recipe: ['id'],
  lootTable: ['id'],
  spawnRule: ['id'],
  tradeTable: ['id'],
  feature: ['id'],
  featureRule: ['id'],
  itemCatalog: ['id'],
}

const layoutTagAttributes = (): Record<string, string[]> => {
  const result: Record<string, string[]> = {}
  for (const tag of new Set([...UI_TAGS, ...FORM_TAGS])) {
    result[tag] = [...LAYOUT_COMMON_ATTRS, ...(LAYOUT_EXTRA_ATTRS[tag] ?? [])]
  }
  return result
}

/**
 * Tag -> attributes the compiler accepts for it. Plain names, `:`-prefixed
 * dynamic bindings and `@` directives are all listed verbatim; the prefix
 * matters because it is part of the name in the AST.
 */
export const TAG_ATTRIBUTES: Record<string, string[]> = {
  // Root tags: only the attributes the transforms actually read.
  script: ['lang'],
  Event: ['@after', '@before', 'tick'],
  Ui: ['setup'],
  Form: ['setup', 'type'],
  Component: [],
  App: [],
  ...REQUIRED_ID_ONLY,
  ...layoutTagAttributes(),
  // Component group tags are pure containers — the compiler never inspects
  // their attributes, so offering `id` there would be a lie.
  ...Object.fromEntries(Object.keys(COMPONENT_GROUPS).map(tag => [tag, []])),
}

/** Attributes inserted with a ready-made value instead of the bare name. */
const ATTR_INSERT: Record<string, string> = {
  lang: 'lang="ts"',
  type: 'type="modal"',
  for: 'for="item in items"',
}

export interface AttrInfo {
  /** one-liner shown in the completion list */
  summary: string
  /** markdown shown on hover; falls back to `summary` */
  doc?: string
}

const dynamicDoc = (name: string): string =>
  `Dynamic binding of \`${name}\`: the value is an expression evaluated when the UI is built, so it may be a plain value, a setup variable or a Ref/Observable.`

/** Attribute name -> documentation, shared by completions and hover. */
export const ATTR_INFO: Record<string, AttrInfo> = {
  id: {
    summary: 'Optional element id (Ui/Form) — required on component children',
    doc: 'Identifier for the element.\n\nOn `<Ui>` / `<Form>` leaves it is optional and forwarded to the element params. On `<Component>` children (`item`, `block`, `entity`, …) it is **required** and doubles as the generated resource file name.',
  },
  lang: {
    summary: "Script language: 'ts' or 'js'",
    doc: "Language of the `<script>` block. `ts` is transpiled, `js` is passed through unchanged. Anything other than `js` is treated as TypeScript, so declaring `lang` explicitly is recommended.",
  },
  '@after': {
    summary: 'Listen on world.afterEvents (mutually exclusive with @before)',
    doc: 'Subscribes the `<Event>` block to `world.afterEvents`. Mutually exclusive with `@before`; declaring both is a compile error. Defaults to `after` when neither is present.',
  },
  '@before': {
    summary: 'Listen on world.beforeEvents (mutually exclusive with @after)',
    doc: 'Subscribes the `<Event>` block to `world.beforeEvents`. Mutually exclusive with `@after`; declaring both is a compile error.',
  },
  tick: {
    summary: 'Repeat interval in ticks (default: fires once)',
    doc: 'Number of ticks between event invocations. Parsed with `parseFloat`; a non-numeric value is ignored and the handler fires once.',
  },
  setup: {
    summary: 'Enable setup mode (collect declarations into the setup context)',
    doc: 'Valueless flag. Switches the block into setup mode: every non-exported top-level declaration is collected into the returned setup object and `defineProp` / hook processing is enabled.',
  },
  type: {
    summary: 'Form type: modal / action / message',
    doc: 'Explicitly set the form type on `<Form>`: `modal` → `ModalFormData`, `action` → `ActionFormData`, `message` → `MessageFormData`. An unknown value silently falls back to `action`. Not read on `<Ui>`, which always builds a `CustomForm`.',
  },
  for: {
    summary: 'Repeat: "item in items"',
    doc: 'Repeats the element for every entry of a setup collection. Syntax is `variable in|of propName`; anything else is a compile error.',
  },
  if: {
    summary: 'Show the element only when a setup value is truthy',
    doc: 'Name of a **setup variable**, not an expression. The element is skipped when the value is falsy.',
  },
  tip: { summary: 'Tooltip text', doc: 'Tooltip shown when hovering the element.' },
  disabled: { summary: 'Disable interaction', doc: 'Marks the element as disabled.' },
  visible: { summary: 'Show or hide the element', doc: 'Controls whether the element is rendered.' },
  description: { summary: 'Longer description text', doc: 'Extra description rendered next to the element.' },
  placeholderText: { summary: 'Placeholder shown in an empty input', doc: 'Placeholder text for `input` / `textField`.' },
  default: { summary: 'Initial value', doc: 'Value the element starts with.' },
  value: { summary: 'Current value (two-way binding in Ui mode)', doc: 'Current value of the element. Inside `<Ui>` the runtime binds `value`, so this is what a Ref/Observable should be attached to.' },
  option: { summary: 'Dropdown options: array or "a,b,c"', doc: 'Options of a `dropdown`, either an array or a comma separated string. In Form mode the string is split on `,`.' },
  min: { summary: 'Lower bound (default 0)', doc: 'Minimum value of a `slider`.' },
  max: { summary: 'Upper bound (default 100 in Ui, 10 in Form)', doc: 'Maximum value of a `slider`.' },
  click: { summary: 'Click handler function name', doc: 'Name of the exported function called when the button is clicked. Always compiled as a plain (non-reactive) accessor, so it never re-binds on change.' },
  img: { summary: 'Button image path (ActionFormData)', doc: 'Image shown on a `button`. Only used by the action form mode.' },
  ':id': { summary: 'Dynamic id', doc: dynamicDoc('id') },
  ':for': { summary: 'Dynamic repeat', doc: `Dynamic form of \`for\`. ${dynamicDoc('for')}` },
  ':if': { summary: 'Dynamic condition', doc: `Dynamic form of \`if\`. ${dynamicDoc('if')}` },
  ':tip': { summary: 'Dynamic tooltip', doc: dynamicDoc('tip') },
  ':disabled': { summary: 'Dynamic disabled state', doc: dynamicDoc('disabled') },
  ':visible': { summary: 'Dynamic visibility', doc: dynamicDoc('visible') },
  ':description': { summary: 'Dynamic description', doc: dynamicDoc('description') },
  ':placeholderText': { summary: 'Dynamic placeholder', doc: dynamicDoc('placeholderText') },
  ':default': { summary: 'Dynamic initial value', doc: dynamicDoc('default') },
  ':value': { summary: 'Dynamic value (two-way)', doc: dynamicDoc('value') },
  ':option': { summary: 'Dynamic dropdown options', doc: dynamicDoc('option') },
  ':min': { summary: 'Dynamic lower bound', doc: dynamicDoc('min') },
  ':max': { summary: 'Dynamic upper bound', doc: dynamicDoc('max') },
  ':click': { summary: 'Dynamic click handler', doc: dynamicDoc('click') },
  ':img': { summary: 'Dynamic button image', doc: dynamicDoc('img') },
}

/** Tag -> short prose used by the hover provider (attributes are appended). */
export const TAG_INFO: Record<string, string> = {
  script: 'Script block for embedded TypeScript/JavaScript code.\n\n**Values:** `lang` (`ts`, `js`)',
  Event: 'Event definition block for Minecraft event handlers.\n\nBinds `world.afterEvents` / `world.beforeEvents` entries to exported functions. Content is one `eventName = handler` line per binding; `McxExtendsBy = ./a.mcx` pulls bindings from another file.',
  Component: 'Component definition block.\n\nGroups custom resources that are emitted as separate behavior pack files. Its children are container tags, each of which takes exactly one child element with a required `id`.',
  Ui: 'UI definition block.\n\nBuilds a reactive `CustomForm`. Add `setup` to collect declarations into the setup context.',
  Form: 'Form definition block.\n\nBuilds a legacy `ModalFormData` / `ActionFormData` / `MessageFormData` form. Add `setup` to collect declarations into the setup context.',
  App: 'Reserved application root. The compiler has no transform for it, so the tag is ignored.',
  items: 'Item definitions container inside `<Component>`.',
  blocks: 'Block definitions container inside `<Component>`.',
  entities: 'Entity definitions container inside `<Component>`.',
  features: 'Feature definitions container inside `<Component>`.',
  feature_rules: 'Feature rule definitions container inside `<Component>`.',
  spawn_rules: 'Spawn rule definitions container inside `<Component>`.',
  recipes: 'Recipe definitions container inside `<Component>`.',
  loot_tables: 'Loot table definitions container inside `<Component>`.',
  trade_tables: 'Trade table definitions container inside `<Component>`.',
  itemCatalog: 'Item catalog container inside `<Component>`; also the name of its own child element.',
  item: 'Custom item definition. Its content is the name of an exported script function.',
  block: 'Custom block definition. Its content is the name of an exported script function.',
  entity: 'Custom entity definition. Its content is the name of an exported script function.',
  feature: 'Custom feature definition (e.g. `ore_feature`, `shaped`, `shapeless`).',
  featureRule: 'Custom feature rule definition with placement conditions.',
  spawnRule: 'Custom spawn rule definition.',
  recipe: 'Custom recipe definition.',
  lootTable: 'Custom loot table definition.',
  tradeTable: 'Custom trade table definition.',
  input: 'Text input field.',
  textField: 'Text input field.',
  toggle: 'Switch control.',
  dropdown: 'Selection dropdown.',
  slider: 'Numeric slider.',
  button: 'Action button.',
  submit: 'Submit button (`Form` only).',
  'button-m': 'Message form button (`Form` only, max 2).',
  label: 'Static text label.',
  body: 'Static text body.',
  header: 'Section header.',
  title: 'Form title.',
  divider: 'Horizontal divider.',
  spacer: 'Vertical spacer.',
  'close-button': 'Form close button.',
}

/** Attributes a tag accepts, rendered for the hover panel. */
export function describeTagAttributes(tagName: string): string {
  const attrs = TAG_ATTRIBUTES[tagName]
  if (!attrs) return ''
  if (attrs.length === 0) return 'none'
  const required = new Set(Object.keys(REQUIRED_ID_ONLY))
  return attrs
    .map(name => (name === 'id' && required.has(tagName) ? '`id` (required)' : `\`${name}\``))
    .join(', ')
}

/** Text inserted for an attribute, or the bare name when there is no default. */
export function attributeInsertText(name: string): string {
  return ATTR_INSERT[name] ?? name
}

/** Tags accepted directly inside `parentTag`. */
export function getChildTags(parentTag: string): string[] {
  if (parentTag === 'Component') return Object.keys(COMPONENT_GROUPS)
  if (parentTag === 'Ui') return [...UI_TAGS]
  if (parentTag === 'Form') return [...FORM_TAGS]
  const child = COMPONENT_GROUPS[parentTag]
  return child ? [child] : []
}

/** Whether `tagName` may be nested somewhere inside `containers`. */
export function acceptsChild(parentTag: string, tagName: string): boolean {
  return getChildTags(parentTag).includes(tagName)
}
