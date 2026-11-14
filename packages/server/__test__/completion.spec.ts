import { describe, expect, it } from 'vitest'
import {
  createMcxCompletionRegistry,
  mergeCompletionContributions,
  parseCompletionManifest,
  serializeCompletionManifest,
} from '../src/completion/index.js'
import type { McxCompletionContribution } from '../src/completion/index.js'

const jsonuiContribution: McxCompletionContribution = {
  name: '@mbler/mcx-plugin-jsonui',
  rootTags: ['JsonUi'],
  tags: [
    {
      name: 'JsonUi',
      detail: 'JSON UI document',
      extends: ['jsonui-root'],
      container: true,
    },
  ],
  attributeSets: {
    'jsonui-root': [
      { name: 'target', detail: 'Target screen' },
      {
        name: 'availability',
        detail: 'Mount mode',
        values: ['file', 'server_form', 'hud'],
      },
    ],
  },
}

describe('completion registry', () => {
  it('exposes the built-in MCX tags', () => {
    const registry = createMcxCompletionRegistry()
    expect(registry.rootTags()).toEqual([
      'script',
      'Event',
      'Component',
      'Ui',
      'Form',
    ])
    expect(registry.childrenOf('Component')).toContain('items')
    expect(registry.childrenOf('Ui')).toContain('toggle')
    expect(registry.tag('Ui')?.container).toBe(true)
  })

  it('resolves shared attribute sets through extends', () => {
    const registry = createMcxCompletionRegistry()
    const names = registry.attributesOf('input').map(attr => attr.name)
    expect(names).toContain('placeholderText')
    expect(names).toContain(':placeholderText')
    // inherited from the ui-control set
    expect(names).toContain(':if')
    expect(names).toContain('description')
  })

  it('merges plugin contributions without disturbing built-ins', () => {
    const registry = createMcxCompletionRegistry(jsonuiContribution)
    expect(registry.rootTags()).toContain('JsonUi')
    expect(registry.rootTags()).toContain('Ui')
    const attrs = registry.attributesOf('JsonUi').map(attr => attr.name)
    expect(attrs).toContain('target')
    expect(attrs).toContain('availability')
    expect(
      registry.attributesOf('JsonUi').find(attr => attr.name === 'availability')
        ?.values,
    ).toContain('server_form')
  })

  it('lets a contribution add attributes to an existing tag', () => {
    const extension: McxCompletionContribution = {
      name: 'ui-extension',
      tags: [
        {
          name: 'Ui',
          attributes: [{ name: 'type', detail: 'Ui kind', values: ['jsonui'] }],
        },
      ],
    }
    const registry = createMcxCompletionRegistry(extension)
    const ui = registry.tag('Ui')
    expect(ui?.container).toBe(true)
    expect(ui?.children).toContain('toggle')
    expect(ui?.attributes.map(attr => attr.name)).toContain('type')
  })

  it('survives circular extends without hanging', () => {
    const cyclic: McxCompletionContribution = {
      name: 'cyclic',
      tags: [
        { name: 'a', extends: ['b'] },
        { name: 'b', extends: ['a'] },
      ],
    }
    const registry = createMcxCompletionRegistry(cyclic)
    expect(registry.attributesOf('a')).toEqual([])
    expect(registry.tag('b')?.name).toBe('b')
  })

  it('withContributions keeps previous layers', () => {
    const base = createMcxCompletionRegistry(jsonuiContribution)
    const next = base.withContributions([
      { name: 'extra', rootTags: ['Layout'] },
    ])
    expect(next.rootTags()).toContain('JsonUi')
    expect(next.rootTags()).toContain('Layout')
  })

  it('mergeCompletionContributions keeps later tag fields', () => {
    const merged = mergeCompletionContributions([
      { name: 'one', tags: [{ name: 'X', detail: 'first', children: ['a'] }] },
      { name: 'two', tags: [{ name: 'X', detail: 'second' }] },
    ])
    expect(merged.tags.get('X')?.detail).toBe('second')
    expect(merged.tags.get('X')?.children).toEqual(['a'])
  })
})

describe('completion manifest', () => {
  it('round-trips contributions', () => {
    const raw = serializeCompletionManifest([jsonuiContribution], '/project')
    const manifest = parseCompletionManifest(raw)
    expect(manifest.project).toBe('/project')
    expect(manifest.contributions).toHaveLength(1)
    expect(manifest.contributions[0]?.name).toBe('@mbler/mcx-plugin-jsonui')
  })

  it('drops entries without a name', () => {
    const manifest = parseCompletionManifest(
      JSON.stringify({ version: 1, contributions: [{ tags: [] }, { name: 'ok' }] }),
    )
    expect(manifest.contributions.map(item => item.name)).toEqual(['ok'])
  })

  it('reports invalid JSON', () => {
    expect(() => parseCompletionManifest('{')).toThrow(/not valid JSON/)
  })
})
