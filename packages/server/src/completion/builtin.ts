import type {
  McxAttributeCompletion,
  McxCompletionContribution,
  McxTagCompletion,
} from './types.js';

/** Tags offered at the top level of a `.mcx` file. */
export const MCX_ROOT_TAGS = [
  'script',
  'Event',
  'Component',
  'Ui',
  'Form',
] as const;

/** Containers accepted inside `<Component>`. */
export const COMPONENT_CONTAINERS = [
  'items',
  'blocks',
  'entities',
  'features',
  'featureRules',
  'spawnRules',
  'recipes',
  'loot_tables',
  'trade_tables',
  'itemCatalog',
] as const;

/** Child tag declared by each `<Component>` container. */
export const COMPONENT_CONTAINER_CHILD: Record<string, string> = {
  items: 'item',
  blocks: 'block',
  entities: 'entity',
  features: 'feature',
  featureRules: 'featureRule',
  spawnRules: 'spawnRule',
  recipes: 'recipe',
  loot_tables: 'lootTable',
  trade_tables: 'tradeTable',
  itemCatalog: 'itemCatalog',
};

export const COMPONENT_LEAF_TAGS = Object.values(COMPONENT_CONTAINER_CHILD);

/** Leaf controls of a reactive `<Ui>` layout. */
export const UI_LAYOUT_TYPES = [
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
] as const;

/** Leaf controls of a legacy `<Form>` layout. */
export const FORM_LAYOUT_TYPES = [
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
] as const;

const SCRIPT_LANGS = ['ts', 'js'];

const attr = (
  name: string,
  detail: string,
  extra?: Partial<McxAttributeCompletion>,
): McxAttributeCompletion => ({ name, detail, ...extra });

/** Attributes valid on every UI control. */
const UI_CONTROL_ATTRIBUTES: McxAttributeCompletion[] = [
  attr('tip', 'Tooltip text'),
  attr(':tip', 'Dynamic tooltip expression'),
  attr('disabled', 'Disabled state'),
  attr(':disabled', 'Dynamic disabled expression'),
  attr('visible', 'Visibility'),
  attr(':visible', 'Dynamic visibility expression'),
  attr('description', 'Description text'),
  attr(':description', 'Dynamic description expression'),
  attr('for', 'For loop expression (e.g. "item in items")'),
  attr('if', 'Conditional expression'),
  attr(':if', 'Dynamic conditional expression'),
];

/** Extra attributes per control, on top of {@link UI_CONTROL_ATTRIBUTES}. */
const CONTROL_EXTRAS: Record<string, McxAttributeCompletion[]> = {
  input: [
    attr('placeholderText', 'Input placeholder text'),
    attr(':placeholderText', 'Dynamic placeholder text'),
    attr('default', 'Default value'),
    attr(':default', 'Dynamic default value'),
    attr(':value', 'Dynamic value binding'),
  ],
  textField: [
    attr('placeholderText', 'Input placeholder text'),
    attr(':placeholderText', 'Dynamic placeholder text'),
    attr('default', 'Default value'),
    attr(':default', 'Dynamic default value'),
    attr(':value', 'Dynamic value binding'),
  ],
  toggle: [
    attr('default', 'Default state (true/false)'),
    attr(':default', 'Dynamic default state'),
    attr(':value', 'Dynamic value binding'),
  ],
  dropdown: [
    attr('default', 'Default selection index'),
    attr(':default', 'Dynamic default index'),
    attr('option', 'Dropdown options (comma-separated or array)'),
    attr(':option', 'Dynamic options'),
    attr(':value', 'Dynamic value binding'),
  ],
  slider: [
    attr('default', 'Default value'),
    attr(':default', 'Dynamic default'),
    attr('min', 'Minimum value'),
    attr(':min', 'Dynamic minimum'),
    attr('max', 'Maximum value'),
    attr(':max', 'Dynamic maximum'),
    attr(':value', 'Dynamic value binding'),
  ],
  button: [
    attr('click', 'Click handler function name'),
    attr(':click', 'Dynamic click handler'),
    attr('img', 'Button image path'),
  ],
  submit: [
    attr('click', 'Click handler function name'),
    attr(':click', 'Dynamic click handler'),
  ],
  'button-m': [
    attr('click', 'Click handler function name'),
    attr(':click', 'Dynamic click handler'),
  ],
};

function controlTag(name: string, layout: string): McxTagCompletion {
  return {
    name,
    detail: `${layout} control`,
    extends: ['ui-control'],
    attributes: CONTROL_EXTRAS[name] ?? [],
  };
}

const controlTags: McxTagCompletion[] = [
  ...[...UI_LAYOUT_TYPES].map(name => controlTag(name, 'Ui')),
  ...[...FORM_LAYOUT_TYPES]
    .filter(name => !(UI_LAYOUT_TYPES as readonly string[]).includes(name))
    .map(name => controlTag(name, 'Form')),
];

/**
 * The built-in MCX DSL data. It is a normal contribution, so plugins can
 * override any entry by contributing the same tag name.
 */
export const builtinCompletionContribution: McxCompletionContribution = {
  name: 'mcx',
  rootTags: [...MCX_ROOT_TAGS],
  scriptLangs: SCRIPT_LANGS,
  attributeSets: {
    'component-container': [
      attr('id', 'Component container identifier'),
      attr('@before', 'Execute before main logic'),
      attr('@after', 'Execute after main logic'),
    ],
    'component-leaf': [
      attr('id', 'Component item identifier'),
      attr('@before', 'Execute before main logic'),
      attr('@after', 'Execute after main logic'),
      attr('type', 'Component type (e.g. ore_feature, shaped, shapeless)'),
    ],
    'ui-control': UI_CONTROL_ATTRIBUTES,
    event: [
      attr('@before', 'Listen on beforeEvents'),
      attr('@after', 'Listen on afterEvents'),
    ],
  },
  tags: [
    {
      name: 'script',
      detail: 'Embedded TypeScript/JavaScript block',
      container: true,
      attributes: [
        attr('lang', 'Script language', {
          insertText: 'lang="ts"',
          values: SCRIPT_LANGS,
        }),
        attr('@before', 'Execute before main logic'),
        attr('@after', 'Execute after main logic'),
      ],
    },
    {
      name: 'Event',
      detail: 'Event handler block',
      container: true,
      extends: ['event'],
    },
    {
      name: 'Component',
      detail: 'Component definition block',
      container: true,
      children: [...COMPONENT_CONTAINERS],
      attributes: [attr('id', 'Component identifier')],
    },
    {
      name: 'Ui',
      detail: 'Reactive CustomForm layout',
      container: true,
      children: [...UI_LAYOUT_TYPES],
      attributes: [attr('id', 'UI identifier')],
    },
    {
      name: 'Form',
      detail: 'Legacy FormData layout',
      container: true,
      children: [...FORM_LAYOUT_TYPES],
      attributes: [
        attr('id', 'Form identifier'),
        attr('type', 'Form kind', { values: ['modal', 'action', 'message'] }),
      ],
    },
    ...COMPONENT_CONTAINERS.map(name => ({
      name,
      detail: 'Component container',
      extends: ['component-container'],
      children: [COMPONENT_CONTAINER_CHILD[name]!],
    })),
    ...COMPONENT_LEAF_TAGS.map(name => ({
      name,
      detail: 'Component definition',
      extends: ['component-leaf'],
      // `<itemCatalog>` is both a container and a leaf; the container entry
      // above wins for children, the attributes still merge in through extends.
    })),
    ...controlTags,
  ],
};
