import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    expect(plugin.getLanguageId('image.jpeg')).toBe('mcx-image')
    expect(plugin.getLanguageId('image.svg')).toBe('mcx-image')
    expect(plugin.getLanguageId('image.gif')).toBe('mcx-image')
    expect(plugin.getLanguageId('file.ts')).toBeUndefined()
    expect(plugin.getLanguageId('file.json')).toBeUndefined()
  })

  it('should createVirtualCode for mcx language', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const snapshot = {
      getText: () => '',
      getLength: () => 0,
      getChangeRange: () => undefined,
    }
    const vc = plugin.createVirtualCode('test.mcx', 'mcx', snapshot)
    expect(vc).toBeDefined()
    expect(vc!.id).toBe('root')
    expect(vc!.languageId).toBe('mcx')
  })

  it('should createVirtualCode for mcx-image language', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const snapshot = {
      getText: () => '',
      getLength: () => 0,
      getChangeRange: () => undefined,
    }
    const vc = plugin.createVirtualCode('image.png', 'mcx-image', snapshot)
    expect(vc).toBeDefined()
    expect(vc!.id).toBe('image-root')
    expect(vc!.languageId).toBe('mcx-image')
    expect(vc!.embeddedCodes).toBeDefined()
    expect(vc!.embeddedCodes.length).toBe(1)
    expect(vc!.embeddedCodes[0].id).toBe('script')
    expect(vc!.embeddedCodes[0].languageId).toBe('typescript')
  })

  it('should return undefined for unknown language', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const snapshot = {
      getText: () => '',
      getLength: () => 0,
      getChangeRange: () => undefined,
    }
    const vc = plugin.createVirtualCode('test.ts', 'typescript', snapshot)
    expect(vc).toBeUndefined()
  })

  it('should updateVirtualCode with MCXVirtualCode instance', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin, createMCXVirtualCode } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)
    const { MCXVirtualCode } = await import('../src/plugin/code')

    const snapshot1 = {
      getText: () => '',
      getLength: () => 0,
      getChangeRange: () => undefined,
    }
    const vc = new MCXVirtualCode(snapshot1)
    const updateSpy = vi.spyOn(vc, 'update')

    const snapshot2 = {
      getText: () => '<script>const x = 1</script>',
      getLength: () => 30,
      getChangeRange: () => undefined,
    }
    const result = plugin.updateVirtualCode('test.mcx', vc, snapshot2)
    expect(updateSpy).toHaveBeenCalledWith(snapshot2)
    expect(result).toBe(vc)
  })

  it('should updateVirtualCode with non-MCXVirtualCode (creates image)', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const oldVc = {
      id: 'old',
      languageId: 'old',
      snapshot: { getText: () => '', getLength: () => 0, getChangeRange: () => undefined },
      mappings: [],
      embeddedCodes: [],
    }

    const snapshot = {
      getText: () => '',
      getLength: () => 0,
      getChangeRange: () => undefined,
    }
    const result = plugin.updateVirtualCode('image.png', oldVc, snapshot)
    expect(result.id).toBe('image-root')
    expect(result.languageId).toBe('mcx-image')
  })

  it('should have correct extraFileExtensions', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const extensions = plugin.typescript.extraFileExtensions
    expect(extensions.find(e => e.extension === 'mcx')!.isMixedContent).toBe(true)
    expect(extensions.find(e => e.extension === 'png')!.isMixedContent).toBe(false)
    expect(extensions.find(e => e.extension === 'svg')!.isMixedContent).toBe(false)
    expect(extensions.find(e => e.extension === 'jpg')!.isMixedContent).toBe(false)
    expect(extensions.find(e => e.extension === 'jpeg')!.isMixedContent).toBe(false)
    expect(extensions.find(e => e.extension === 'gif')!.isMixedContent).toBe(false)
  })
})

describe('getServiceScript', () => {
  it('should return service script when embeddedCodes has script', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const vc = {
      id: 'test',
      languageId: 'mcx',
      snapshot: { getText: () => '', getLength: () => 0, getChangeRange: () => undefined },
      mappings: [],
      embeddedCodes: [
        {
          id: 'script',
          languageId: 'typescript',
          snapshot: { getText: () => '', getLength: () => 0, getChangeRange: () => undefined },
          mappings: [],
          embeddedCodes: [],
        },
      ],
    }

    const result = plugin.typescript.getServiceScript(vc)
    expect(result).toBeDefined()
    expect(result!.code.id).toBe('script')
    expect(result!.code.languageId).toBe('typescript')
    expect(result!.scriptKind).toBe(ts.ScriptKind.TS)
    expect(result!.extension).toBe('.ts')
  })

  it('should return undefined when no script embedded code exists', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const vc = {
      id: 'test',
      languageId: 'mcx',
      snapshot: { getText: () => '', getLength: () => 0, getChangeRange: () => undefined },
      mappings: [],
      embeddedCodes: [],
    }

    const result = plugin.typescript.getServiceScript(vc)
    expect(result).toBeUndefined()
  })

  it('should return JS scriptKind for javascript languageId', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    const vc = {
      id: 'test',
      languageId: 'mcx',
      snapshot: { getText: () => '', getLength: () => 0, getChangeRange: () => undefined },
      mappings: [],
      embeddedCodes: [
        {
          id: 'script',
          languageId: 'javascript',
          snapshot: { getText: () => '', getLength: () => 0, getChangeRange: () => undefined },
          mappings: [],
          embeddedCodes: [],
        },
      ],
    }

    const result = plugin.typescript.getServiceScript(vc)
    expect(result).toBeDefined()
    expect(result!.scriptKind).toBe(ts.ScriptKind.JS)
    expect(result!.extension).toBe('.js')
  })
})

describe('thisId', () => {
  it('should handle string scriptId', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId('/path/to/file.mcx')).toBe('mcx')
    expect(plugin.getLanguageId('/path/to/file.png')).toBe('mcx-image')
  })

  it('should handle object with fileName', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId({ fileName: 'test.mcx' })).toBe('mcx')
    expect(plugin.getLanguageId({ fileName: 'test.png' })).toBe('mcx-image')
  })

  it('should handle object with path', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId({ path: 'test.mcx' })).toBe('mcx')
  })

  it('should handle object with fsPath', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId({ fsPath: 'test.mcx' })).toBe('mcx')
  })

  it('should handle null/undefined scriptId', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId(null)).toBeUndefined()
    expect(plugin.getLanguageId(undefined)).toBeUndefined()
  })

  it('should handle empty string scriptId', async () => {
    const ts = await import('typescript')
    const { createMCXLanguagePlugin } = await import('../src/plugin/index')
    const plugin = createMCXLanguagePlugin(ts)

    expect(plugin.getLanguageId('')).toBeUndefined()
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
