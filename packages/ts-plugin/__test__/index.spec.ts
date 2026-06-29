import { describe, it, expect, vi } from 'vitest'

vi.mock('@volar/typescript/lib/quickstart/createLanguageServicePlugin.js', () => ({
  createLanguageServicePlugin: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock('@mbler/mcx-server', () => ({
  createMCXLanguagePlugin: vi.fn().mockReturnValue({}),
}))

describe('TS Plugin', () => {
  it('should create plugin using Volar factory', async () => {
    const plugin = await import('../src/index')
    expect(plugin).toBeDefined()
  })
})
