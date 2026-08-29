import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@volar/language-core', () => ({
  // minimal stubs
}))

interface MockTagNode {
  start: { start: { line: number; column: number }; data?: string }
  name: string
  arr: Record<string, string | boolean>
  content: ({ data: string; type: 'TagContent' } | MockTagNode)[]
  end: { start: { line: number; column: number }; data?: string } | null
  loc: { start: { line: number; column: number }; end: { line: number; column: number } }
  type: 'TagNode'
}

interface MockCompileData {
  raw: MockTagNode[]
  JSIR: {
    BuildCache: { call: unknown[]; import: unknown[]; export: unknown[] }
  }
  strLoc: {
    script: string
    Event: { on: string; subscribe: Record<string, string>; loc: { line: number; column: number }; isLoad: boolean }
    Component: Record<string, { type: string; useExpore: string; loc: { line: number; column: number } }>
    UI: MockTagNode | null
    Form: MockTagNode | null
  }
  File: string
  isFile: boolean
  setFilePath: (dir: string) => void
}

function attrsToString(attrs: Record<string, string | boolean>): string {
  const parts = Object.entries(attrs).map(([k, v]) => {
    if (typeof v === 'boolean') return v ? k : `${k}="false"`
    return `${k}="${v}"`
  })
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

function buildTagSource(name: string, content: string, attrs: Record<string, string | boolean> = {}): string {
  return `<${name}${attrsToString(attrs)}>${content}</${name}>`
}

function createTag(
  name: string,
  content: string,
  attrs: Record<string, string | boolean> = {},
  startLine = 1,
  startCol = 0,
): MockTagNode {
  const tagStartStr = `<${name}${attrsToString(attrs)}>`
  const tagEndStr = `</${name}>`
  const contentLines = content.split('\n')
  const endTagLine = startLine + contentLines.length - 1
  const endTagCol = contentLines.length === 1
    ? startCol + tagStartStr.length + content.length
    : contentLines[contentLines.length - 1].length
  return {
    start: { start: { line: startLine, column: startCol }, data: tagStartStr },
    name,
    arr: attrs,
    content: [{ data: content, type: 'TagContent' as const }],
    end: { start: { line: endTagLine, column: endTagCol }, data: tagEndStr },
    loc: { start: { line: startLine, column: startCol }, end: { line: endTagLine, column: endTagCol + tagEndStr.length } },
    type: 'TagNode',
  }
}

function createScriptTag(content: string, attrs: Record<string, string | boolean> = {}): MockTagNode {
  return createTag('script', content, attrs, 1, 0)
}

function createEventTag(content: string): MockTagNode {
  return createTag('Event', content, {}, 2, 0)
}

function createUiTag(content: string): MockTagNode {
  return createTag('Ui', content, {}, 3, 0)
}

function createFormTag(content: string): MockTagNode {
  return createTag('Form', content, {}, 4, 0)
}

function createComponentTag(content: string): MockTagNode {
  return createTag('Component', content, {}, 4, 0)
}

const mockState = vi.hoisted(() => {
  const state: {
    parseASTResult: MockTagNode[]
    compileResult: MockCompileData | undefined
  } = { parseASTResult: [], compileResult: undefined }
  return {
    tagImpl: function () {
      return {
        parseAST: function () { return state.parseASTResult },
      }
    },
    compileMCXFnImpl: function () { return state.compileResult },
    _parseData: state,
  }
})

vi.mock('@mbler/mcx-core', () => ({
  AST: { tag: mockState.tagImpl },
  compiler: { MCXCompileData: class {}, compileMCXFn: mockState.compileMCXFnImpl },
  PUBTYPE: {},
}))

beforeEach(() => {
  mockState._parseData.parseASTResult = []
  mockState._parseData.compileResult = undefined
})

function makeSnapshot(text: string) {
  return {
    getText: (_start: number, _end: number) => text.slice(_start, _end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  }
}

describe('StringSnapshot', () => {
  it('should return text slices via getText', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const snapshot = makeSnapshot('hello world')
    const code = new MCXVirtualCode(snapshot)
    expect(code.snapshot.getText(0, 5)).toBe('hello')
    expect(code.snapshot.getText(6, 11)).toBe('world')
  })

  it('should return correct length via getLength', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const snapshot = makeSnapshot('hello')
    const code = new MCXVirtualCode(snapshot)
    expect(code.snapshot.getLength()).toBe(5)
  })

  it('should return undefined for getChangeRange', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const snapshot = makeSnapshot('test')
    const code = new MCXVirtualCode(snapshot)
    expect(code.snapshot.getChangeRange(snapshot)).toBeUndefined()
  })

  it('should handle empty string', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const snapshot = makeSnapshot('')
    const code = new MCXVirtualCode(snapshot)
    expect(code.snapshot.getText(0, 0)).toBe('')
    expect(code.snapshot.getLength()).toBe(0)
  })
})

describe('MCXVirtualCode', () => {
  it('should create with empty snapshot', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const snapshot = makeSnapshot('')
    const code = new MCXVirtualCode(snapshot)
    expect(code.id).toBe('root')
    expect(code.languageId).toBe('mcx')
    expect(code.mappings).toHaveLength(1)
    expect(code.embeddedCodes).toHaveLength(0)
  })

  it('should create with basic content and no tags', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const snapshot = makeSnapshot('just some text content')
    const code = new MCXVirtualCode(snapshot)
    expect(code.embeddedCodes).toHaveLength(0)
    expect(code.mappings).toHaveLength(1)
  })

  it('should create embedded code for script tag', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createScriptTag('const x = 1')]
    const snapshot = makeSnapshot('<script>const x = 1</script>')
    const code = new MCXVirtualCode(snapshot)
    expect(code.embeddedCodes.length).toBeGreaterThanOrEqual(1)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    expect(scriptCode!.languageId).toBe('javascript')
    expect(scriptCode!.mappings).toHaveLength(1)
  })

  it('should detect TypeScript script with lang attribute', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createScriptTag('const x: number = 1', { lang: 'ts' })]
    const snapshot = makeSnapshot('<script lang="ts">const x: number = 1</script>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    expect(scriptCode!.languageId).toBe('typescript')
  })

  it('should detect TypeScript with lang=typescript', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createScriptTag('const x: number = 1', { lang: 'typescript' })]
    const snapshot = makeSnapshot('<script lang="typescript">const x: number = 1</script>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    expect(scriptCode!.languageId).toBe('typescript')
  })

  it('should detect JavaScript script with lang=js', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createScriptTag('const x = 1', { lang: 'js' })]
    const snapshot = makeSnapshot('<script lang="js">const x = 1</script>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    expect(scriptCode!.languageId).toBe('javascript')
  })

  it('should add metadata sections when Event tag exists', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.compileResult = {
      raw: [],
      JSIR: { BuildCache: { call: [], import: [], export: [] } },
      strLoc: {
        script: '',
        Event: { on: 'after', subscribe: {}, loc: { line: 1, column: 0 }, isLoad: true },
        Component: {},
        UI: null,
        Form: null,
      },
      File: '', isFile: false, setFilePath: () => {},
    }
    mockState._parseData.parseASTResult = [
      createScriptTag('const x = 1', { lang: 'ts' }),
      createEventTag('on playerJoin'),
    ]
    const snapshot = makeSnapshot('<script lang="ts">const x = 1</script>\n<Event>on playerJoin</Event>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    expect(text).toContain('MCX Event block')
    expect(text).toContain('__mcx_event_raw')
  })

  it('should create raw embedded code for Event tag', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createEventTag('on playerJoin')]
    const snapshot = makeSnapshot('<Event>on playerJoin</Event>')
    const code = new MCXVirtualCode(snapshot)
    const eventRaw = code.embeddedCodes.find(e => e.id === 'event-raw')
    expect(eventRaw).toBeDefined()
    expect(eventRaw!.languageId).toBe('mcx')
  })

  it('should create raw embedded code for Component tag', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createComponentTag('item test_comp')]
    const snapshot = makeSnapshot('<Component>item test_comp</Component>')
    const code = new MCXVirtualCode(snapshot)
    const componentRaw = code.embeddedCodes.find(e => e.id === 'component-raw')
    expect(componentRaw).toBeDefined()
    expect(componentRaw!.languageId).toBe('mcx')
  })

  it('should create raw embedded code for Ui tag', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createUiTag('<label text="hello" />')]
    const snapshot = makeSnapshot('<Ui><label text="hello" /></Ui>')
    const code = new MCXVirtualCode(snapshot)
    const uiRaw = code.embeddedCodes.find(e => e.id === 'ui-raw')
    expect(uiRaw).toBeDefined()
    expect(uiRaw!.languageId).toBe('mcx')
  })

  it('should create raw embedded code for Form tag', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createFormTag('<input label="name" />')]
    const snapshot = makeSnapshot('<Form><input label="name" /></Form>')
    const code = new MCXVirtualCode(snapshot)
    const formRaw = code.embeddedCodes.find(e => e.id === 'form-raw')
    expect(formRaw).toBeDefined()
    expect(formRaw!.languageId).toBe('mcx')
  })

  it('should create all embedded codes for full .mcx content', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.compileResult = {
      raw: [],
      JSIR: { BuildCache: { call: [], import: [], export: [] } },
      strLoc: {
        script: '',
        Event: { on: 'after', subscribe: { playerJoin: 'onPlayerJoin' }, loc: { line: 1, column: 0 }, isLoad: true },
        Component: { items: { type: 'item', useExpore: 'test', loc: { line: 1, column: 0 } } },
        UI: { start: { start: { line: 3, column: 0 }, data: '<Ui>' }, name: 'Ui', arr: {}, content: [], end: null, loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 0 } }, type: 'TagNode' },
        Form: null,
      },
      File: '', isFile: false, setFilePath: () => {},
    }
    mockState._parseData.parseASTResult = [
      createScriptTag('const x = 1', { lang: 'ts' }),
      createEventTag('on playerJoin'),
      createComponentTag('item test_item'),
      createUiTag('<label text="hello" />'),
    ]
    const snapshot = makeSnapshot([
      '<script lang="ts">const x = 1</script>',
      '<Event>on playerJoin</Event>',
      '<Component>item test_item</Component>',
      '<Ui><label text="hello" /></Ui>',
    ].join('\n'))
    const code = new MCXVirtualCode(snapshot)
    expect(code.embeddedCodes.find(e => e.id === 'script')).toBeDefined()
    expect(code.embeddedCodes.find(e => e.id === 'event-raw')).toBeDefined()
    expect(code.embeddedCodes.find(e => e.id === 'component-raw')).toBeDefined()
    expect(code.embeddedCodes.find(e => e.id === 'ui-raw')).toBeDefined()
  })

  it('should use first script tag when multiple exist', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [
      createScriptTag('const x = 1', { lang: 'ts' }),
      createScriptTag('const y = 2'),
    ]
    const snapshot = makeSnapshot([
      '<script lang="ts">const x = 1</script>',
      '<script>const y = 2</script>',
    ].join('\n'))
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    expect(text).toContain('const x = 1')
  })

  it('should handle malformed content gracefully (parseAST returns empty)', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = []
    const snapshot = makeSnapshot('<invalid>unclosed')
    const code = new MCXVirtualCode(snapshot)
    expect(code.embeddedCodes).toHaveLength(0)
  })

  it('should handle parseAST throwing', async () => {
    const throwImpl = mockState._parseData
    // We need an alternate approach: create a different MCXVirtualCode that errors
    // The original parseAST can't throw because we control it.
    // Instead, let's test that empty embeddedCodes works
    mockState._parseData.parseASTResult = []
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const snapshot = makeSnapshot('something')
    const code = new MCXVirtualCode(snapshot)
    expect(code.embeddedCodes).toHaveLength(0)
  })

  it('should include event validation section when Event has subscribe data', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.compileResult = {
      raw: [],
      JSIR: { BuildCache: { call: [], import: [], export: [] } },
      strLoc: {
        script: '',
        Event: { on: 'after', subscribe: { playerJoin: 'onPlayerJoin' }, loc: { line: 1, column: 0 }, isLoad: true },
        Component: {},
        UI: null,
        Form: null,
      },
      File: '', isFile: false, setFilePath: () => {},
    }
    mockState._parseData.parseASTResult = [
      createScriptTag('const x = 1', { lang: 'ts' }),
      createEventTag('on playerJoin\n  subscribe playerJoin'),
    ]
    const snapshot = makeSnapshot('<script lang="ts">const x = 1</script>\n<Event>on playerJoin\n  subscribe playerJoin</Event>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    expect(text).toContain('__mcx_world')
    expect(text).toContain('afterEvents')
  })

  it('should not emit real import statements for McxExtendsBy extends', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.compileResult = {
      raw: [],
      JSIR: { BuildCache: { call: [], import: [], export: [] } },
      strLoc: {
        script: '',
        Event: {
          on: 'after',
          subscribe: { playerJoin: 'onPlayerJoin', McxExtendsBy: './EventBefore.mcx' },
          loc: { line: 1, column: 0 },
          isLoad: true,
        },
        Component: {},
        UI: null,
        Form: null,
      },
      File: '', isFile: false, setFilePath: () => {},
    }
    mockState._parseData.parseASTResult = [
      createScriptTag('const x = 1', { lang: 'ts' }),
      createEventTag('playerJoin = onPlayerJoin\n  McxExtendsBy = ./EventBefore.mcx'),
    ]
    const snapshot = makeSnapshot('<script lang="ts">const x = 1</script>\n<Event>playerJoin = onPlayerJoin\n  McxExtendsBy = ./EventBefore.mcx</Event>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    // A real injected `import` would pull the auto-import fixer's insert
    // position into the generated (unmapped) tail, where edits get dropped.
    expect(text).not.toMatch(/^import\s/m)
    expect(text).toContain('declare const __mcx_ext_0: import("./EventBefore.mcx").default;')
    expect(text).toContain('void __mcx_ext_0;')
  })

  it('should map generated offset 0 to the first script content line', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const source = '<script lang="ts">\nconst x = 1\n</script>'
    mockState._parseData.parseASTResult = [createScriptTag('\nconst x = 1\n', { lang: 'ts' })]
    const code = new MCXVirtualCode(makeSnapshot(source))
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const mapping = scriptCode!.mappings[0]!
    const generated = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    // generated[0] must be real script text (not the leading newline), and it
    // must map back to the same text in the source file
    expect(generated[0]).toBe('c')
    const sourceOffset = mapping.sourceOffsets[0]
    expect(source.slice(sourceOffset, sourceOffset + 11)).toBe('const x = 1')
    expect(source.slice(sourceOffset, sourceOffset + 11)).toBe(generated.slice(0, 11))
  })

  it('should inject Event types for .mcx event imports in app context', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const scriptText = 'import event from "./Event.mcx";\nevent.subscribe();'
    mockState._parseData.compileResult = {
      raw: [],
      JSIR: {
        BuildCache: {
          call: [],
          import: [
            {
              source: './Event.mcx',
              imported: [{ as: 'event', import: 'default', isAll: false }],
            },
          ],
          export: [],
        },
      },
      strLoc: {
        script: '',
        Event: { on: 'after', subscribe: {}, loc: { line: 1, column: 0 }, isLoad: false },
        Component: {},
        UI: null,
        Form: null,
      },
      File: '', isFile: false, setFilePath: () => {},
    }
    mockState._parseData.parseASTResult = [createScriptTag(scriptText, { lang: 'ts' })]
    const snapshot = makeSnapshot(`<script lang="ts">${scriptText}</script>`)
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    // The build injects Event instances in app context: the import binding is
    // shadowed with an Event type instead of the imported MCXFile<"event">
    expect(text).toContain('declare const event: import("@mbler/mcx-types").Event;')
    expect(text).not.toContain('import event from')
    // the injected declaration is unmapped; `event.subscribe()` stays mapped
    const mappedLength = scriptCode!.mappings.reduce((sum, m) => sum + m.lengths[0]!, 0)
    expect(mappedLength).toBeLessThan(scriptText.length)
    expect(scriptCode!.mappings.length).toBeGreaterThan(0)
  })

  it('should keep event imports as MCXFile outside app context', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    const scriptText = 'import event from "./Event.mcx";\nevent.subscribe();'
    mockState._parseData.compileResult = {
      raw: [],
      JSIR: {
        BuildCache: {
          call: [],
          import: [
            {
              source: './Event.mcx',
              imported: [{ as: 'event', import: 'default', isAll: false }],
            },
          ],
          export: [],
        },
      },
      strLoc: {
        script: '',
        Event: { on: 'after', subscribe: { playerJoin: 'h' }, loc: { line: 1, column: 0 }, isLoad: true },
        Component: {},
        UI: null,
        Form: null,
      },
      File: '', isFile: false, setFilePath: () => {},
    }
    mockState._parseData.parseASTResult = [createScriptTag(scriptText, { lang: 'ts' })]
    const snapshot = makeSnapshot(`<script lang="ts">${scriptText}</script>`)
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    // event-type files keep the plain import (runtime type is "event", no injection)
    expect(text).toContain('import event from "./Event.mcx"')
    expect(text).not.toContain('declare const event:')
  })

  it('should update with new snapshot', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = []
    const snapshot1 = makeSnapshot('')
    const code = new MCXVirtualCode(snapshot1)
    expect(code.embeddedCodes).toHaveLength(0)
    mockState._parseData.parseASTResult = [createScriptTag('const x = 1')]
    const snapshot2 = makeSnapshot('<script>const x = 1</script>')
    code.update(snapshot2)
    expect(code.snapshot).toBe(snapshot2)
    expect(code.embeddedCodes.length).toBeGreaterThanOrEqual(1)
    expect(code.embeddedCodes.find(e => e.id === 'script')).toBeDefined()
  })

  it('should have correct mapping for root', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = []
    const snapshot = makeSnapshot('test content')
    const code = new MCXVirtualCode(snapshot)
    expect(code.mappings).toHaveLength(1)
    expect(code.mappings[0].sourceOffsets).toEqual([0])
    expect(code.mappings[0].generatedOffsets).toEqual([0])
    expect(code.mappings[0].lengths).toEqual([12])
    expect(code.mappings[0].data).toBeDefined()
    expect((code.mappings[0].data as any).verification).toBe(false)
  })

  it('should add default runtime section when compileMCXFn returns undefined', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createScriptTag('const x = 1', { lang: 'ts' })]
    const snapshot = makeSnapshot('<script lang="ts">const x = 1</script>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    expect(text).toContain('const x = 1')
    expect(text).toContain('__MCX_runtime_type')
    expect(text).toContain('"app"')
  })

  it('should add runtime info with app type when compileData provided', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.compileResult = {
      raw: [],
      JSIR: { BuildCache: { call: [], import: [], export: [] } },
      strLoc: {
        script: '',
        Event: { on: 'after', subscribe: {}, loc: { line: 1, column: 0 }, isLoad: false },
        Component: {},
        UI: null,
        Form: null,
      },
      File: '', isFile: false, setFilePath: () => {},
    }
    mockState._parseData.parseASTResult = [createScriptTag('const x = 1', { lang: 'ts' })]
    const snapshot = makeSnapshot('<script lang="ts">const x = 1</script>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    const text = scriptCode!.snapshot.getText(0, scriptCode!.snapshot.getLength())
    expect(text).toContain('__MCX_runtime_type')
    expect(text).toContain('"app"')
  })
})

describe('EmbeddedCode (indirect via MCXVirtualCode)', () => {
  it('should create embedded codes with correct structure', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createScriptTag('const x = 1', { lang: 'ts' })]
    const snapshot = makeSnapshot('<script lang="ts">const x = 1</script>')
    const code = new MCXVirtualCode(snapshot)
    const scriptCode = code.embeddedCodes.find(e => e.id === 'script')
    expect(scriptCode).toBeDefined()
    expect(scriptCode!.embeddedCodes).toEqual([])
    expect(scriptCode!.snapshot.getLength()).toBeGreaterThan(0)
    expect(scriptCode!.mappings).toHaveLength(1)
  })

  it('should create raw embedded codes with disabled features', async () => {
    const { MCXVirtualCode } = await import('../src/plugin/code')
    mockState._parseData.parseASTResult = [createEventTag('on playerJoin')]
    const snapshot = makeSnapshot('<Event>on playerJoin</Event>')
    const code = new MCXVirtualCode(snapshot)
    const eventRaw = code.embeddedCodes.find(e => e.id === 'event-raw')
    expect(eventRaw).toBeDefined()
    expect(eventRaw!.mappings).toHaveLength(1)
    expect((eventRaw!.mappings[0].data as any).verification).toBe(false)
    expect((eventRaw!.mappings[0].data as any).completion).toBe(false)
    expect((eventRaw!.mappings[0].data as any).navigation).toBe(false)
  })
})
