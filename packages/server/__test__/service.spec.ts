import { describe, it, expect } from 'vitest'

describe('service/index', () => {
  it('should re-export createMCXLanguagePlugin', async () => {
    const service = await import('../src/service/index')
    expect(service.createMCXLanguagePlugin).toBeDefined()
    expect(typeof service.createMCXLanguagePlugin).toBe('function')
  })

  it('should create a valid language plugin via re-export', async () => {
    const ts = await import('typescript')
    const service = await import('../src/service/index')

    const plugin = service.createMCXLanguagePlugin(ts)
    expect(plugin).toBeDefined()
    expect(plugin.typescript).toBeDefined()
    expect(plugin.typescript.extraFileExtensions).toBeDefined()
    expect(plugin.typescript.extraFileExtensions.length).toBeGreaterThanOrEqual(1)
    expect(plugin.typescript.extraFileExtensions[0].extension).toBe('mcx')
  })
})
