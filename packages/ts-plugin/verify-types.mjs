import ts from 'typescript'
import * as path from 'node:path'
import * as fs from 'node:fs'

const root = 'D:/CodeUse/mcbe/addon/xiuxianMod'
const { createMCXLanguagePlugin } = await import('file:///D:/CodeUse/mcbe/mcx-language-server/packages/server/dist/index.js')
const { decorateLanguageServiceHost } = await import('@volar/typescript/lib/node/decorateLanguageServiceHost.js')
const { createLanguage } = await import('file:///D:/CodeUse/mcbe/mcx-language-server/node_modules/.pnpm/@volar+language-core@2.4.28/node_modules/@volar/language-core/index.js')

const plugin = createMCXLanguagePlugin(ts)
const snapshotOf = text => ({ getText: (s, e) => text.slice(s, e), getLength: () => text.length, getChangeRange: () => undefined })
const resolveFileLanguageId = (await import('@volar/typescript/lib/common.js')).resolveFileLanguageId

const registry = new Map()
const language = createLanguage([
  plugin,
  { getLanguageId: id => resolveFileLanguageId(String(id)) },
], registry, (id) => {
  const p = typeof id === 'string' ? id : String(id)
  if (fs.existsSync(p) && !registry.has(id)) {
    language.scripts.set(p, snapshotOf(fs.readFileSync(p, 'utf-8')))
  }
})

const host = {
  getScriptFileNames() {
    return ts.sys.readDirectory('D:/CodeUse/mcbe/addon/xiuxianMod/behavior/scripts', ['.ts', '.mcx'], undefined, undefined, 10)
  },
  getScriptVersion: () => '0',
  getScriptSnapshot(fileName) {
    return snapshotOf(fs.readFileSync(fileName, 'utf-8'))
  },
  getCurrentDirectory: () => root,
  getCompilationSettings: () => ({ ...ts.getDefaultCompilerOptions(), module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, allowNonTsExtensions: true, noEmit: true, skipLibCheck: true }),
  getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
  readFile: f => fs.readFileSync(f, 'utf-8'),
  fileExists: f => fs.existsSync(f),
  readDirectory: (p, exts, excl, incl, depth) => ts.sys.readDirectory(p, exts, excl, incl, depth),
  directoryExists: d => ts.sys.directoryExists(d),
  getDirectories: d => ts.sys.getDirectories(d),
  getScriptKind: f => f.endsWith('.mcx') ? ts.ScriptKind.Deferred : ts.ScriptKind.Unknown,
}

decorateLanguageServiceHost(ts, language, host)
const ls = ts.createLanguageService(host)

// show the generated virtual code for app.mcx and the type of `event`
const mcxFile = path.join(root, 'behavior/scripts/app.mcx').split(path.sep).join('/')
const script = language.scripts.get(mcxFile).generated.root.embeddedCodes.find(c => c.id === 'script')
console.log('=== generated ===')
console.log(script.snapshot.getText(0, script.snapshot.getLength()))
console.log('=== mappings ===', JSON.stringify(script.mappings))

const file = mcxFile
const sf = ls.getProgram().getSourceFile(file)
const quick = ls.getQuickInfoAtPosition(file, sf.text.indexOf('event.subscribe') + 6)
console.log('quickInfo of `event`:', quick && ts.displayPartsToString(quick.displayParts))
process.exit(0)
