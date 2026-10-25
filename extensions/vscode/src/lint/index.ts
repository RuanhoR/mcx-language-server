import * as path from 'node:path'
import {
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  languages,
  workspace,
  type ExtensionContext,
  type TextDocument,
} from 'vscode'

/**
 * `.mcx` linting through `@mbler/eslint-plugin-mcx` — the same parser and
 * rules the CLI ESLint setup uses, so editor diagnostics and `eslint .` never
 * disagree. The plugin parses the template with `@mbler/mcx-core`'s own AST
 * and resolves world event names against the `@minecraft/server` typings
 * installed in the *user's* project.
 */

const COLLECTION_ID = 'mcx-eslint'
const DIAGNOSTIC_SOURCE = 'mcx-eslint'
const LINT_DEBOUNCE_MS = 400
/** Parsing a `<script>` block runs the TypeScript parser; skip huge files. */
const MAX_LINT_LENGTH = 512 * 1024

interface LintMessage {
  ruleId: string | null
  message: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  severity: number
  fatal?: boolean
}

type EslintModule = typeof import('eslint')
type McxPluginModule = typeof import('@mbler/eslint-plugin-mcx')
type McxRuleConfig = { meta: McxPluginModule['default']['meta']; rules: McxPluginModule['rules'] }

let modulesPromise: Promise<[EslintModule, McxPluginModule]> | undefined

/**
 * Both packages are loaded lazily: they pull in the TypeScript parser and
 * `@mbler/mcx-core`, which must not weigh down extension activation.
 */
function loadLinterModules(): Promise<[EslintModule, McxPluginModule]> {
  modulesPromise ??= Promise.all([
    import('eslint'),
    import('@mbler/eslint-plugin-mcx'),
  ])
  return modulesPromise
}

interface LintEngine {
  lint(text: string, filename: string, allowUnknownEvents: boolean): LintMessage[]
}

function buildConfig(
  plugin: McxRuleConfig,
  parser: McxPluginModule['parser'],
  allowUnknownEvents: boolean,
): Parameters<EslintModule['Linter']['prototype']['verify']>[1] {
  return [
    {
      files: ['**/*.mcx'],
      // Pass a trimmed plugin object: the exported one references itself
      // through `configs.recommended`, which flat config has no use for.
      plugins: { mcx: plugin },
      languageOptions: {
        parser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      },
      rules: {
        'mcx/valid-event-binding': ['error', { allowUnknown: allowUnknownEvents }],
        'mcx/no-duplicate-root-tag': 'error',
        'mcx/valid-prop-value': 'error',
        'mcx/require-script-lang': 'warn',
      },
    },
  ]
}

/** One engine per project root, so `context.cwd` (and the event cache) match. */
const engines = new Map<string, Promise<LintEngine>>()

function getEngine(cwd: string): Promise<LintEngine> {
  let engine = engines.get(cwd)
  if (!engine) {
    engine = loadLinterModules().then(([eslint, mcx]) => {
      const linter = new eslint.Linter({ cwd, configType: 'flat' })
      const plugin: McxRuleConfig = { meta: mcx.default.meta, rules: mcx.rules }
      return {
        lint(text, filename, allowUnknownEvents) {
          return linter.verify(
            text,
            buildConfig(plugin, mcx.parser, allowUnknownEvents),
            { filename },
          ) as LintMessage[]
        },
      }
    })
    engines.set(cwd, engine)
  }
  return engine
}

function isMcxDocument(document: TextDocument): boolean {
  return document.languageId === 'mcx' || document.uri.fsPath.endsWith('.mcx')
}

function getCwd(document: TextDocument): string {
  return workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath)
}

/**
 * Map an ESLint report onto a squiggle. The plugin reports whole tags, which
 * for a `<Ui>` block means a 50 line highlight — clamp multi-line ranges to
 * the line the tag starts on.
 */
function toDiagnostic(document: TextDocument, message: LintMessage): Diagnostic {
  const line = clampLine(document, message.line - 1)
  const startChar = Math.max(0, message.column - 1)
  const endLine = clampLine(document, (message.endLine ?? message.line) - 1)
  const endChar = Math.max(startChar, (message.endColumn ?? message.column + 1) - 1)
  const range =
    endLine === line
      ? new Range(line, startChar, line, endChar)
      : new Range(line, startChar, line, document.lineAt(line).range.end.character)

  const diagnostic = new Diagnostic(
    range,
    message.message,
    message.severity === 2
      ? DiagnosticSeverity.Error
      : DiagnosticSeverity.Warning,
  )
  diagnostic.source = DIAGNOSTIC_SOURCE
  if (message.ruleId) {
    diagnostic.code = message.ruleId.replace(/^mcx\//, '')
  }
  return diagnostic
}

function clampLine(document: TextDocument, line: number): number {
  return Math.max(0, Math.min(line, document.lineCount - 1))
}

async function lintDocument(
  document: TextDocument,
  allowUnknownEvents: boolean,
): Promise<Diagnostic[]> {
  const text = document.getText()
  const engine = await getEngine(getCwd(document))
  const messages = engine.lint(text, document.uri.fsPath, allowUnknownEvents)

  return messages
    // A parse error is what a half-typed tag looks like; stay quiet instead of
    // flickering a red squiggle on every keystroke.
    .filter(message => !message.fatal && message.ruleId && message.line > 0)
    .map(message => toDiagnostic(document, message))
}

function readConfig(): { enable: boolean; allowUnknownEvents: boolean } {
  const config = workspace.getConfiguration('mcx')
  return {
    enable: config.get<boolean>('lint.enable', true),
    allowUnknownEvents: config.get<boolean>('lint.allowUnknownEvents', false),
  }
}

/**
 * Lint every open `.mcx` document on open / change / save and publish the
 * results as diagnostics. Cheap enough to run in-process: the linter is
 * debounced and skipped entirely while the feature is disabled.
 */
export function registerMcxLinter(context: ExtensionContext): void {
  const collection = languages.createDiagnosticCollection(COLLECTION_ID)
  context.subscriptions.push(collection)

  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastLinted = new Map<string, string>()
  /** Guards against an older lint run overwriting a newer result. */
  const runs = new Map<string, number>()

  const cancel = (key: string) => {
    const timer = timers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(key)
    }
  }

  const run = async (document: TextDocument) => {
    if (!isMcxDocument(document)) return
    const key = document.uri.toString()
    cancel(key)

    const { enable, allowUnknownEvents } = readConfig()
    if (!enable) {
      lastLinted.delete(key)
      collection.delete(document.uri)
      return
    }

    const text = document.getText()
    if (text.length > MAX_LINT_LENGTH || lastLinted.get(key) === text) return
    lastLinted.set(key, text)

    const runId = (runs.get(key) ?? 0) + 1
    runs.set(key, runId)
    try {
      const diagnostics = await lintDocument(document, allowUnknownEvents)
      if (runs.get(key) !== runId) return
      collection.set(document.uri, diagnostics)
    } catch {
      // The template parser throws on malformed input (and the plugin needs a
      // readable project layout); never surface that as a diagnostic.
    }
  }

  const schedule = (document: TextDocument) => {
    if (!isMcxDocument(document)) return
    const key = document.uri.toString()
    cancel(key)
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        void run(document)
      }, LINT_DEBOUNCE_MS),
    )
  }

  context.subscriptions.push(
    workspace.onDidOpenTextDocument(document => void run(document)),
    workspace.onDidChangeTextDocument(event => schedule(event.document)),
    workspace.onDidSaveTextDocument(document => void run(document)),
    workspace.onDidCloseTextDocument(document => {
      const key = document.uri.toString()
      cancel(key)
      lastLinted.delete(key)
      runs.delete(key)
      collection.delete(document.uri)
    }),
    workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('mcx.lint')) return
      for (const document of workspace.textDocuments) {
        lastLinted.delete(document.uri.toString())
        if (isMcxDocument(document)) void run(document)
      }
    }),
  )

  for (const document of workspace.textDocuments) {
    if (isMcxDocument(document)) void run(document)
  }
}
