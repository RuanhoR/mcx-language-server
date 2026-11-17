import {
  _MCXstructureLocComponentTypes,
  COMMON_ATTRS,
  FORM_TAGS as CORE_FORM_TAGS,
  TAG_ATTRS,
  UI_TAGS as CORE_UI_TAGS,
} from '@mbler/mcx-core';
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

/** Containers accepted inside `<Component>` — the compiler's component map. */
export const COMPONENT_CONTAINERS = Object.keys(
  _MCXstructureLocComponentTypes,
);

/** Child tag declared by each `<Component>` container. */
export const COMPONENT_CONTAINER_CHILD: Record<string, string> = {
  ..._MCXstructureLocComponentTypes,
};

export const COMPONENT_LEAF_TAGS = Object.values(COMPONENT_CONTAINER_CHILD);

/** Leaf controls of a reactive `<Ui>` layout. */
export const UI_LAYOUT_TYPES = [...CORE_UI_TAGS];

/** Leaf controls of a legacy `<Form>` layout. */
export const FORM_LAYOUT_TYPES = [...CORE_FORM_TAGS];

const SCRIPT_LANGS = ['ts', 'js'];

const attr = (
  name: string,
  detail: string,
  extra?: Partial<McxAttributeCompletion>,
): McxAttributeCompletion => ({ name, detail, ...extra });

const ATTR_DETAILS: Record<string, string> = {
  id: 'Element identifier',
  ':id': 'Dynamic element identifier',
  for: 'For loop expression (e.g. "item in items")',
  ':for': 'Dynamic for expression',
  if: 'Conditional expression',
  ':if': 'Dynamic conditional expression',
  tip: 'Tooltip text',
  ':tip': 'Dynamic tooltip expression',
  disabled: 'Disabled state',
  ':disabled': 'Dynamic disabled expression',
  visible: 'Visibility',
  ':visible': 'Dynamic visibility expression',
  description: 'Description text',
  ':description': 'Dynamic description expression',
  placeholderText: 'Input placeholder text',
  ':placeholderText': 'Dynamic placeholder text',
  default: 'Default value',
  ':default': 'Dynamic default value',
  value: 'Current value (two-way binding in Ui mode)',
  ':value': 'Dynamic value binding',
  option: 'Dropdown options (comma-separated or array)',
  ':option': 'Dynamic options',
  min: 'Minimum value',
  ':min': 'Dynamic minimum',
  max: 'Maximum value',
  ':max': 'Dynamic maximum',
  click: 'Click handler function name',
  ':click': 'Dynamic click handler',
  img: 'Button image path',
  ':img': 'Dynamic button image',
};

const attrFor = (name: string): McxAttributeCompletion =>
  attr(name, ATTR_DETAILS[name] ?? 'MCX attribute');

/** Attributes valid on every UI control — the compiler's common set. */
const UI_CONTROL_ATTRIBUTES: McxAttributeCompletion[] = [...COMMON_ATTRS].map(
  attrFor,
);

/** Extra attributes per control, from the compiler's per-tag table. */
const CONTROL_EXTRAS: Record<string, McxAttributeCompletion[]> =
  Object.fromEntries(
    Object.entries(TAG_ATTRS).map(([tag, attrs]) => [
      tag,
      [...attrs].map(attrFor),
    ]),
  );

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
