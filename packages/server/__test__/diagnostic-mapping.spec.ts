import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { MCXVirtualCode } from '../src/plugin/code'

const BROKEN_MCX = [
  '<Component>',
  '  <blocks>',
  '    <block id="luckblock-normal.json">luckBlock</block>',
  '  </blocks>',
  '</Component>',
  '<script lang="ts">',
  'import { BlockComponent } from "@mbler/mcx-component";',
  'export const luckBlock = new BlockComponent({',
  '  format: "1.21.80",',
  '  id: "rluckblock:block",',
  '  menu_category: { category: "construction" }',
  '});',
  '',
  'luckBlock.setGeometry("minecraft:geometry.full_block");',
  'luckBlock.setLoot("loot_tables/empty.json");',
  'luckBlock.setMaterialInstances(Object.fromEntries(',
  '  (["down", "up", "west", "east", "south", "north"] as const).map(v => [v, { texture: "luckblock" }])',
  '));',
  'luckBlock.',
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

/** Map a generated offset back to the source offset via the code's mappings. */
function generatedToSource(
  code: { mappings: { sourceOffsets: number[]; generatedOffsets: number[]; lengths: number[] }[] },
  genOffset: number,
): number {
  for (const mapping of code.mappings) {
    for (let i = 0; i < mapping.generatedOffsets.length; i++) {
      const gen = mapping.generatedOffsets[i]!
      const len = mapping.lengths[i]!
      if (genOffset >= gen && genOffset < gen + len) {
        return mapping.sourceOffsets[i]! + (genOffset - gen)
      }
    }
  }
  return -1
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}

describe('diagnostic mapping for incomplete member expression', () => {
  it('TS service reports Identifier expected and it maps back to the mcx line', () => {
    const snapshot = snapshotOf(BROKEN_MCX)
    const virtualCode = new MCXVirtualCode(snapshot)
    const embedded = virtualCode.embeddedCodes.find(c => c.id === 'script')
    expect(embedded).toBeDefined()

    const content = embedded!.snapshot.getText(0, embedded!.snapshot.getLength())
    const fileName = '/test/virtual.mcx.ts'

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [fileName],
      getScriptVersion: () => '0',
      getScriptSnapshot: f =>
        f === fileName ? snapshotOf(content) : undefined,
      getCurrentDirectory: () => '/test',
      getCompilationSettings: () => ({
        allowNonTsExtensions: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      }),
      getDefaultLibFileName: options => ts.getDefaultLibFileName(options),
      getDefaultLibLocation: () => ts.getDefaultLibLocation?.() ?? '/test',
      readFile: () => undefined,
      fileExists: () => false,
      readDirectory: () => [],
      directoryExists: () => true,
      getDirectories: () => [],
      getScriptKind: f =>
        f === fileName ? ts.ScriptKind.TS : ts.ScriptKind.Unknown,
    }
    const service = ts.createLanguageService(host)
    const syntactic = service.getSyntacticDiagnostics(fileName)
    const semantic = service.getSemanticDiagnostics(fileName)
    const all = [...syntactic, ...semantic]

    const identifierExpected = all.find(
      d => ts.flattenDiagnosticMessageText(d.messageText, ' ') === 'Identifier expected.',
    )
    expect(identifierExpected).toBeDefined()
    // The diagnostic is on the incomplete `luckBlock.` statement, which is
    // mcx line 19 (1-based); the terminator maps back to its last character.
    const genStart = identifierExpected!.start!
    const sourceOffset = generatedToSource(embedded!, genStart)
    expect(sourceOffset).toBeGreaterThanOrEqual(0)
    expect(lineOf(BROKEN_MCX, sourceOffset)).toBe(19)

    // And every mapped diagnostic must land inside the script block (mcx lines
    // 6..21), never on the generated tail sections.
    for (const d of all) {
      if (d.file?.fileName !== fileName) continue
      const mapped = generatedToSource(embedded!, d.start!)
      if (mapped < 0) continue
      expect(mapped).toBeLessThanOrEqual(BROKEN_MCX.indexOf('</script>'))
    }
    service.dispose()
  })
})
