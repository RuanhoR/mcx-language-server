import { describe, it, expect, vi } from 'vitest'

vi.mock('@volar/language-core', () => ({
  // minimal stubs
}))

describe('MCXLanguagePlugin', () => {
  it('should create plugin with TypeScript support', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)
    expect(plugin).toBeDefined()
    expect(plugin.typescript).toBeDefined()
    expect(plugin.typescript.extraFileExtensions).toBeDefined()
    expect(plugin.typescript.extraFileExtensions.length).toBeGreaterThanOrEqual(1)
    expect(plugin.typescript.extraFileExtensions[0].extension).toBe('mcx')
  })

  it('should return correct language IDs', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId('test.mcx')).toBe('mcx')
    expect(plugin.getLanguageId('image.png')).toBe('mcx-image')
    expect(plugin.getLanguageId('image.jpg')).toBe('mcx-image')
    expect(plugin.getLanguageId('file.ts')).toBeUndefined()
    expect(plugin.getLanguageId('file.json')).toBeUndefined()
  })
})

describe('thisId', () => {
  it('should extract filename from string', async () => {
    const code = await import('../src/plugin/index')
    // Access internal thisId via module (test behavior through getLanguageId)
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId('/path/to/file.mcx')).toBe('mcx')
    expect(plugin.getLanguageId('/path/to/file.png')).toBe('mcx-image')
  })
})

describe('MCXVirtualCode', () => {
  it('should create virtual code from snapshot', async () => {
    const { createMCXVirtualCode } = await import('../src/plugin/index')
    const snapshot = {
      getText: (start: number, end: number) => '',
      getLength: () => 0,
      getChangeRange: () => undefined,
    }
    const vc = createMCXVirtualCode(snapshot)
    expect(vc).toBeDefined()
    expect(vc.id).toBe('root')
    expect(vc.languageId).toBe('mcx')
  })
})
