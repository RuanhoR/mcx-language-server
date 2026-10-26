import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MCXVirtualCode } from '../src/plugin/code'

// An app-mode .mcx file that imports an event file: the generated virtual
// script shadows the imported binding with `declare const event: Event` so
// `event.subscribe()` type-checks. The internal renamed import binding used to
// leak into hovers/completions ("(alias) const __mcx_import_0: any").
const APP_WITH_EVENT_IMPORT = [
  '<script lang="ts">',
  'import event from "./event.mcx";',
  'event.subscribe();',
  '</script>',
].join('\n')

function snapshotOf(text: string) {
  return {
    getText(start: number, end: number) {
      return text.slice(start, end)
    },
    getLength() {
      return text.length
    },
    getChangeRange(): undefined {
      return undefined
    },
  }
}

function makeService(content: string) {
  const fileName = '/test/virtual.mcx.ts'
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => '0',
    getScriptSnapshot: f => (f === fileName ? snapshotOf(content) : undefined),
    getCurrentDirectory: () => '/test',
    getCompilationSettings: () => ({ allowNonTsExtensions: true, noEmit: true }),
    getDefaultLibFileName: o => ts.getDefaultLibFileName(o),
    readFile: () => undefined,
    fileExists: () => false,
    readDirectory: () => [],
    directoryExists: () => true,
    getScriptKind: () => ts.ScriptKind.TS,
  }
  const service = ts.createLanguageService(host)
  return { service, fileName, dispose: () => service.dispose() }
}

describe('event import shadowing does not leak internal bindings', () => {
  it('keeps the internal import binding out of the value namespace', async () => {
    const snapshot = snapshotOf(APP_WITH_EVENT_IMPORT)
    const code = new MCXVirtualCode(snapshot)
    const embedded = code.embeddedCodes.find(c => c.id === 'script')!
    expect(embedded).toBeDefined()
    const content = embedded.snapshot.getText(0, embedded.snapshot.getLength())

    // The module import stays real (type-only) so go-to-definition on the
    // specifier still opens the event file...
    expect(content).toMatch(/import type \S+ from ["']\.\/event\.mcx["']/)
    // ...but the internal binding must not be a value, and the user-facing
    // `event` binding must come from the shadowing declaration.
    expect(content).toMatch(/declare const event: /)
    expect(content).not.toMatch(/(?:^|\n)(?:import|const|let|var) (?:\* as )?__mcx_import_/)

    const { service, fileName, dispose } = makeService(content)
    // `event.subscribe()` type-checks through the shadow. Environment
    // artifacts of this bare test host are ignored: 2307 (no file system to
    // resolve modules from), 2304 for `Omit` (default lib not loaded) — in the
    // real server volar's project resolves modules and loads the TS libs.
    const semantic = service
      .getSemanticDiagnostics(fileName)
      .filter(d => d.file?.fileName === fileName && d.code !== 2307 && d.code !== 2304)
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '))
    expect(semantic).toEqual([])

    // The shadow type must not be `any` (this test project has no
    // @mbler/mcx-types, so the structural fallback applies): subscribe() takes
    // strings, numbers must be rejected (TS 2345). Checked through a real
    // ts.Program — the bare in-memory host above skips the TS libs and produces
    // too much noise for a precise assertion.
    const dir = mkdtempSync(join(tmpdir(), 'mcx-event-shadow-'))
    const probeFile = join(dir, 'virtual.mcx.ts')
    writeFileSync(
      probeFile,
      content + '\n;(event as any).subscribeProbe = (n: number) => event.subscribe(123);',
    )
    const program = ts.createProgram([probeFile], {
      noEmit: true,
      strict: false,
      allowNonTsExtensions: true,
    })
    const typeErrors = ts
      .getPreEmitDiagnostics(program)
      .filter(d => d.code === 2345)
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '))
    expect(typeErrors.length).toBeGreaterThan(0)

    // Value completions must not offer the internal binding
    const source = embedded.snapshot.getText(0, embedded.snapshot.getLength())
    const cursor = source.indexOf('event.subscribe()')
    const completions = service.getCompletionsAtPosition(
      fileName,
      cursor,
      undefined,
    )
    const names = (completions?.entries ?? []).map(e => e.name)
    expect(names).toContain('event')
    expect(names.filter(n => n.startsWith('__mcx_import'))).toEqual([])
    dispose()
  })

  it('maps the imported binding to the shadow declaration', async () => {
    const snapshot = snapshotOf(APP_WITH_EVENT_IMPORT)
    const code = new MCXVirtualCode(snapshot)
    const embedded = code.embeddedCodes.find(c => c.id === 'script')!
    const source = APP_WITH_EVENT_IMPORT
    const content = embedded.snapshot.getText(0, embedded.snapshot.getLength())

    // source offset of `event` in the import statement (line 2, col 7)
    const bindingOffset = source.indexOf('import event') + 'import '.length
    const genOffsetOfShadow = embedded.mappings.find(m => {
      const off = m.sourceOffsets[0]!
      return off <= bindingOffset && bindingOffset < off + m.lengths[0]!
    })?.generatedOffsets[0]
    expect(genOffsetOfShadow).toBeDefined()
    // the mapped generated position is the `event` of `declare const event`
    const declText = content.slice(genOffsetOfShadow! - 'declare const '.length, genOffsetOfShadow! + 'event'.length)
    expect(declText).toBe('declare const event')
  })
})
