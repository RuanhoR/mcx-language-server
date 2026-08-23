import {
  CancellationToken,
  CompletionItem,
  CompletionItemKind,
  Definition,
  DefinitionLink,
  Hover,
  Location,
  MarkdownString,
  Position,
  Range,
  SnippetString,
  commands,
  extensions,
  languages,
  window,
  workspace,
  type CompletionItemProvider,
  type DefinitionProvider,
  type DocumentFormattingEditProvider,
  type ExtensionContext,
  type HoverProvider,
  type TextDocument,
} from 'vscode'
import * as path from 'node:path'
import type * as mcx from '@mbler/mcx-core'
import type { LanguageClient } from 'vscode-languageclient/node.js'
import { createMCXLanguageClient } from './client/index.js'
import { formatMCXDocument } from './format/index.js'

type MCXPosition = mcx.PubType.MCXPosition
type MCXTagNode = mcx.PubType.ParsedTagNode

const TAG_COMPLETIONS = ['script', 'Event', 'Component', 'Ui', 'Form']
const CONTAINER_TAGS = new Set([
  'Component',
  'Ui',
  'Form',
  'Event',
  'script',
  'items',
  'blocks',
  'entities',
  'features',
  'featureRules',
  'spawnRules',
  'recipes',
  'itemCatalog',
])
const SCRIPT_LANG_VALUES = ['ts', 'js']
const UI_LAYOUT_TYPES = ['input', 'textField', 'toggle', 'dropdown', 'slider', 'button', 'label', 'body', 'header', 'title', 'divider', 'spacer', 'close-button']
const FORM_LAYOUT_TYPES = ['input', 'dropdown', 'submit', 'toggle', 'slider', 'button', 'button-m', 'body', 'divider', 'title']
const COMPONENT_PARENT_TAGS = ['items', 'blocks', 'entities', 'features', 'featureRules', 'spawnRules', 'recipes', 'loot_tables', 'trade_tables', 'itemCatalog']
const COMPONENT_CHILD_TAGS = ['item', 'block', 'entity', 'feature', 'featureRule', 'spawnRule', 'recipe', 'lootTable', 'tradeTable', 'itemCatalog']
const MCX_EXTENSION_ID = 'ruanhor.mcx-vscode-client'
let client: LanguageClient | undefined
patchTypeScriptExtension()

const astCache = new Map<string, { tags: MCXTagNode[]; compileData: any; timestamp: number }>()
const AST_CACHE_TTL = 500

// Lazy-load @mbler/mcx-core on first provider call.  A static import would
// drag `typescript` (a mcx-core dependency) into the eager vendor chunk,
// breaking extension activation in installed environments where TS resolves
// through our stub.
let mcxModulePromise: Promise<typeof mcx> | undefined
function loadMcx(): Promise<typeof mcx> {
  return (mcxModulePromise ??= import('@mbler/mcx-core'))
}

async function getCachedAST(source: string): Promise<{ tags: MCXTagNode[]; compileData: any }> {
  const cached = astCache.get(source)
  const now = Date.now()
  if (cached && now - cached.timestamp < AST_CACHE_TTL) {
    return cached
  }
  let tags: MCXTagNode[] = []
  let compileData: any = undefined
  try {
    const core = await loadMcx()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tags = new (core as any).AST.tag(source).parseAST() as MCXTagNode[]
  } catch {}
  try {
    const core = await loadMcx()
    compileData = (core as any).compiler.compileMCXFn(source)
  } catch {}
  const result = { tags, compileData }
  astCache.set(source, { ...result, timestamp: now })
  if (astCache.size > 50) {
    const oldest = [...astCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
    if (oldest) astCache.delete(oldest[0])
  }
  return result
}

export function activate(context: ExtensionContext): void {
  client = createMCXLanguageClient(context);
  client.start().catch((e: Error) => {
    window.showErrorMessage(`MCX language server failed to start: ${e.message}`);
  });

  const tsserverRestartTimer = setTimeout(() => {
    void commands.executeCommand('typescript.restartTsServer')
  }, 3000)
  context.subscriptions.push({
    dispose: () => clearTimeout(tsserverRestartTimer),
  })

  const formattingProvider: DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(document, options) {
      return formatMCXDocument(document, options)
    },
  }

  context.subscriptions.push(
    languages.registerDocumentFormattingEditProvider(
      { language: 'mcx' },
      formattingProvider,
    ),
  )

  const completionProvider: CompletionItemProvider = {
    provideCompletionItems(document, position) {
      return provideMCXCompletions(document, position)
    },
  }

  context.subscriptions.push(
    languages.registerCompletionItemProvider(
      { language: 'mcx' },
      completionProvider,
      '<',
      '/',
      ' ',
      ':',
      '@',
      '=',
      '"',
      "'",
    ),
  )

  const hoverProvider: HoverProvider = {
    provideHover(document, position) {
      return provideMCXHover(document, position)
    },
  }

  context.subscriptions.push(
    languages.registerHoverProvider({ language: 'mcx' }, hoverProvider),
  )

  const definitionProvider: DefinitionProvider = {
    provideDefinition(document, position, token) {
      return provideMCXDefinition(document, position, token)
    },
  }

  context.subscriptions.push(
    languages.registerDefinitionProvider(
      { language: 'mcx' },
      definitionProvider,
    ),
  )

  const openDisposable = workspace.onDidOpenTextDocument(doc => {
    void ensureMCXLanguage(doc)
  })
  context.subscriptions.push(openDisposable)

  for (const doc of workspace.textDocuments) {
    void ensureMCXLanguage(doc)
  }

  const restartCommand = commands.registerCommand(
    'mcx.restart.language',
    () => {
      void restartLanguageServer(context)
    },
  )
  context.subscriptions.push(restartCommand)

  context.subscriptions.push({
    dispose: () => {
      void client?.stop()
    },
  })

  context.subscriptions.push(
    workspace.onDidSaveTextDocument(document => {
      if (document.languageId === 'mcx' || document.languageId === 'typescript' || document.languageId === 'javascript' || document.languageId === 'json' || document.languageId === 'jsonc') {
        client?.sendNotification('workspace/didChangeWatchedFiles', {
          changes: [{ uri: document.uri.toString(), type: 2 }],
        })
        // Redundant safety net: ensures project refresh even if Volar's file watcher
        // chain drops the workspace/didChangeWatchedFiles notification
        client?.sendNotification('mcx/fileChanged', { uri: document.uri.toString() })
      }
    }),
  )
}

export async function deactivate(): Promise<void> {
  if (!client) {
    return
  }

  await client.stop()
  client = undefined
}

function patchTypeScriptExtension(): void {
  const mcxExtension = extensions.getExtension(MCX_EXTENSION_ID)
  if (mcxExtension) {
    mcxExtension.packageJSON.contributes.typescriptServerPlugins = [
      {
        name: 'mcx-typescript-plugin-pack',
        enableForWorkspaceTypeScriptVersions: true,
      },
    ]
  }
}

async function restartLanguageServer(context: ExtensionContext): Promise<void> {
  if (client) {
    await client.stop()
    client = undefined
  }

  client = createMCXLanguageClient(context)
  try {
    await client.start()
    window.showInformationMessage('MCX language server restarted successfully.')
  } catch (e) {
    window.showErrorMessage(`MCX language server restart failed: ${(e as Error).message}`)
  }
}

async function ensureMCXLanguage(document: TextDocument): Promise<void> {
  if (!document.uri.fsPath.endsWith('.mcx')) {
    return
  }
  const tsLike = ['plaintext', 'typescript', 'javascript', 'typescriptreact', 'javascriptreact']
  if (tsLike.includes(document.languageId)) {
    try {
      await languages.setTextDocumentLanguage(document, 'mcx')
    } catch {
      // unable to set language
    }
  }
}

interface OpenTagEntry {
  name: string
  line: number
}

function getOpenTagEntries(
  document: TextDocument,
  untilOffset: number,
): OpenTagEntry[] {
  const source = document.getText()
  const beforeCursor = source.slice(0, untilOffset)
  const entries: OpenTagEntry[] = []
  // Include closing tags (`</tag>`) so they pop the open-tag stack; otherwise
  // closed siblings stay on the stack and the parent context is wrong.
  const tagRegex = /<\/?([A-Za-z][\w:-]*)[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(beforeCursor)) !== null) {
    if (match[0].startsWith('</')) {
      const name = match[1]
      if (entries.length > 0 && entries[entries.length - 1]!.name === name) {
        entries.pop()
      }
    } else if (!match[0].endsWith('/>')) {
      entries.push({
        name: match[1]!,
        line: document.positionAt(match.index).line,
      })
    }
  }
  return entries
}

function getParentTagContext(
  document: TextDocument,
  position: Position,
): string | undefined {
  const offset = document.offsetAt(position)
  const entries = getOpenTagEntries(document, offset)
  if (entries.length === 0) return undefined
  const top = entries[entries.length - 1]!
  // While typing top-down the previous sibling is usually still unclosed
  // (e.g. `<title>text` without `</title>` yet). If the innermost open tag
  // is a leaf and the cursor is on a later line, the cursor is actually a
  // SIBLING of that tag — completions belong to its parent instead.
  if (!CONTAINER_TAGS.has(top.name) && position.line > top.line) {
    return entries.length >= 2 ? entries[entries.length - 2]!.name : undefined
  }
  return top.name
}

function getChildTagCompletions(parentTag: string): string[] {
  switch (parentTag) {
    case 'Component':
      return COMPONENT_PARENT_TAGS
    case 'items':
      return ['item']
    case 'blocks':
      return ['block']
    case 'entities':
      return ['entity']
    case 'features':
      return ['feature']
    case 'featureRules':
      return ['featureRule']
    case 'spawnRules':
      return ['spawnRule']
    case 'recipes':
      return ['recipe']
    case 'itemCatalog':
      return ['itemCatalog']
    case 'Ui':
      return UI_LAYOUT_TYPES
    case 'Form':
      return FORM_LAYOUT_TYPES
    default:
      return TAG_COMPLETIONS
  }
}

function getOpenTagStack(source: string): string[] {
  const stack: string[] = []
  const tagRegex = /<\/?([A-Za-z][\w:-]*)[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(source)) !== null) {
    if (match[0].startsWith('</')) {
      if (stack.length > 0 && stack[stack.length - 1] === match[1]) {
        stack.pop()
      }
    } else if (!match[0].endsWith('/>')) {
      stack.push(match[1])
    }
  }
  return stack
}

async function provideMCXCompletions(
  document: TextDocument,
  position: Position
): Promise<CompletionItem[]> {
  const linePrefix = document
    .lineAt(position.line)
    .text.slice(0, position.character)
  const fullLine = document.lineAt(position.line).text

  if (/<\/[A-Za-z:_-]*$/.test(linePrefix)) {
    const openTags = getOpenTagStack(document.getText())
    if (openTags.length === 0) return []
    const lastOpen = openTags[openTags.length - 1]
    const item = new CompletionItem(lastOpen, CompletionItemKind.Keyword)
    item.insertText = lastOpen + '>'
    item.detail = 'Close tag'
    item.filterText = lastOpen
    return [item]
  }

  if (/<[A-Za-z:_-]*$/.test(linePrefix)) {
    const parentContext = getParentTagContext(document, position)
    const suggestions = parentContext
      ? getChildTagCompletions(parentContext)
      : TAG_COMPLETIONS
    // The trigger char '<' is already in the buffer when this branch matches;
    // inserting `name>$0</name>` right after it yields `<name></name>`.
    return suggestions.map(name => {
      const item = new CompletionItem(name, CompletionItemKind.Keyword)
      item.insertText = new SnippetString(`${name}>$0</${name}>`)
      item.detail = parentContext ? `${parentContext} child` : 'MCX tag'
      return item
    })
  }

  if (!isInsideOpenTag(linePrefix)) {
    return []
  }

  if (isCompletingScriptLang(linePrefix)) {
    return SCRIPT_LANG_VALUES.map(lang => {
      const item = new CompletionItem(lang, CompletionItemKind.EnumMember)
      item.insertText = lang
      item.detail = 'script lang'
      return item
    })
  }

  const scriptBlock = await getScriptBlock(document.getText())
  if (
    scriptBlock &&
    isInsideScriptBlockContent(document, position, scriptBlock)
  ) {
    return provideScriptCompletions(document, position, fullLine, linePrefix)
  }

  const tagName = currentTagName(linePrefix)
  if (!tagName) return []

  return getAttributeCompletions(tagName, linePrefix)
}

function getAttributeCompletions(tagName: string, linePrefix: string): CompletionItem[] {
  const items: CompletionItem[] = []
  const existingAttrMatch = linePrefix.match(/\s([\w@:-]+)/g)
  const existingAttrs = new Set(
    existingAttrMatch?.map(a => a.trim()) ?? [],
  )

  function addAttr(name: string, detail: string, insertText?: string) {
    if (existingAttrs.has(name)) return
    const item = new CompletionItem(name, CompletionItemKind.Property)
    item.detail = detail
    if (insertText) item.insertText = insertText
    items.push(item)
  }

  addAttr('id', 'Unique identifier')

  if (tagName === 'script') {
    addAttr('lang', 'Script language', 'lang="ts"')
    addAttr('@before', 'Execute before main logic')
    addAttr('@after', 'Execute after main logic')
  } else if (tagName === 'Event') {
    addAttr('@before', 'Listen on beforeEvents')
    addAttr('@after', 'Listen on afterEvents')
  } else if (tagName === 'Ui') {
    addAttr('id', 'UI identifier')
  } else if (tagName === 'Component') {
    addAttr('id', 'Component identifier')
  } else if (COMPONENT_PARENT_TAGS.includes(tagName)) {
    addAttr('@before', 'Execute before main logic')
    addAttr('@after', 'Execute after main logic')
  } else if (COMPONENT_CHILD_TAGS.includes(tagName)) {
    addAttr('id', 'Component item identifier')
    addAttr('@before', 'Execute before main logic')
    addAttr('@after', 'Execute after main logic')
    addAttr('type', 'Component type (e.g., ore_feature, shaped, shapeless)')
  } else if (UI_LAYOUT_TYPES.includes(tagName) || FORM_LAYOUT_TYPES.includes(tagName)) {
    addAttr('tip', 'Tooltip text')
    addAttr(':tip', 'Dynamic tooltip expression')
    addAttr('disabled', 'Disabled state')
    addAttr(':disabled', 'Dynamic disabled expression')
    addAttr('visible', 'Visibility')
    addAttr(':visible', 'Dynamic visibility expression')
    addAttr('description', 'Description text')
    addAttr(':description', 'Dynamic description expression')
    addAttr('for', 'For loop expression (e.g. "item in items")')
    addAttr('if', 'Conditional expression')
    addAttr(':if', 'Dynamic conditional expression')

    if (tagName === 'input' || tagName === 'textField') {
      addAttr('placeholderText', 'Input placeholder text')
      addAttr(':placeholderText', 'Dynamic placeholder text')
      addAttr('default', 'Default value')
      addAttr(':default', 'Dynamic default value')
      addAttr(':value', 'Dynamic value binding')
    } else if (tagName === 'toggle') {
      addAttr('default', 'Default state (true/false)')
      addAttr(':default', 'Dynamic default state')
      addAttr(':value', 'Dynamic value binding')
    } else if (tagName === 'dropdown') {
      addAttr('default', 'Default selection index')
      addAttr(':default', 'Dynamic default index')
      addAttr('option', 'Dropdown options (comma-separated or array)')
      addAttr(':option', 'Dynamic options')
      addAttr(':value', 'Dynamic value binding')
    } else if (tagName === 'slider') {
      addAttr('default', 'Default value')
      addAttr(':default', 'Dynamic default')
      addAttr('min', 'Minimum value')
      addAttr(':min', 'Dynamic minimum')
      addAttr('max', 'Maximum value')
      addAttr(':max', 'Dynamic maximum')
      addAttr(':value', 'Dynamic value binding')
    } else if (tagName === 'button' || tagName === 'submit' || tagName === 'button-m') {
      addAttr('click', 'Click handler function name')
      addAttr(':click', 'Dynamic click handler')
      if (tagName === 'button') {
        addAttr('img', 'Button image path')
      }
    }
  } else {
    addAttr('@before', 'Execute before main logic')
    addAttr('@after', 'Execute after main logic')
  }

  return items
}

async function provideScriptCompletions(
  document: TextDocument,
  position: Position,
  fullLine: string,
  linePrefix: string,
): Promise<CompletionItem[]> {
  const completions: CompletionItem[] = []

  if (/import\s*$/.test(linePrefix) || /import\s+[\w$]*$/.test(linePrefix)) {
    completions.push(
      new CompletionItem('Event', CompletionItemKind.Module),
      new CompletionItem('createApp', CompletionItemKind.Function),
    )
  }

  if (/import\s+[\w$]*\s+from\s+["'][\w./]*$/.test(linePrefix)) {
    completions.push(
      new CompletionItem('"./event"', CompletionItemKind.Reference),
      new CompletionItem('"./events"', CompletionItemKind.Reference),
    )
  }

  if (/ctx\.$/.test(linePrefix) || /ctx\.event/.test(linePrefix)) {
    completions.push(new CompletionItem('event', CompletionItemKind.Property))
  }

  if (/\.subscribe\(?["']?$/.test(linePrefix.trim())) {
    const source = document.getText()
    const { tags } = await getCachedAST(source)
    const eventTag = tags.find(t => t.name === 'Event')
    if (eventTag) {
      const eventOn = typeof eventTag.arr?.['@before'] === 'string' ? 'before' : 'after'
      const events = getMinecraftEvents(eventOn)
      for (const evt of events) {
        const item = new CompletionItem(evt, CompletionItemKind.Event)
        item.detail = `Minecraft ${eventOn} event`
        completions.push(item)
      }
    }
  }

  if (/Event\.$/.test(linePrefix)) {
    const eventMethods = ['subscribe', 'unsubscribe', 'useWorld', 'createApp']
    for (const method of eventMethods) {
      const item = new CompletionItem(method, CompletionItemKind.Method)
      item.detail = 'Event method'
      completions.push(item)
    }
  }

  return completions
}

let minecraftEventsCache: { after: string[]; before: string[] } | null = null

function getMinecraftEvents(on: 'after' | 'before'): string[] {
  if (minecraftEventsCache) {
    return on === 'after' ? minecraftEventsCache.after : minecraftEventsCache.before
  }

  const knownAfterEvents = [
    'playerJoin', 'playerLeave', 'playerDie', 'playerRespawn',
    'blockBreak', 'blockPlace', 'itemUse', 'itemUseOn',
    'entityHit', 'entityDie', 'projectileHit',
    'weatherChange', 'timeChange',
  ]

  const knownBeforeEvents = [
    'itemUse', 'itemUseOn', 'blockBreak', 'blockPlace',
  ]

  try {
    const fs = require('fs')
    const path = require('path')
    const workspaceFolders = workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath
      const searchPaths = [
        path.join(rootPath, 'node_modules', '@minecraft', 'server'),
        path.join(rootPath, 'scripts', 'node_modules', '@minecraft', 'server'),
      ]
      for (const p of searchPaths) {
        const dtsPath = path.join(p, 'index.d.ts')
        if (fs.existsSync(dtsPath)) {
          const content = fs.readFileSync(dtsPath, 'utf-8')
          const afterMatch = content.match(/interface WorldAfterEvents\s*\{([^}]+)\}/)
          const beforeMatch = content.match(/interface WorldBeforeEvents\s*\{([^}]+)\}/)
          if (afterMatch) {
            minecraftEventsCache = {
              after: extractPropertyNames(afterMatch[1]),
              before: beforeMatch ? extractPropertyNames(beforeMatch[1]) : knownBeforeEvents,
            }
            return on === 'after' ? minecraftEventsCache.after : minecraftEventsCache.before
          }
        }
      }
    }
  } catch {}

  minecraftEventsCache = { after: knownAfterEvents, before: knownBeforeEvents }
  return on === 'after' ? knownAfterEvents : knownBeforeEvents
}

function extractPropertyNames(body: string): string[] {
  const names: string[] = []
  const regex = /\b(\w+)\s*:\s*(.+?);/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(body)) !== null) {
    if (!match[1].startsWith('readonly') && match[1] !== '') {
      names.push(match[1])
    }
  }
  if (names.length === 0) {
    const simpleMatch = body.match(/\b(\w+)\s*:/g)
    if (simpleMatch) {
      for (const m of simpleMatch) {
        const name = m.replace(/\s*:/, '').trim()
        if (name) names.push(name)
      }
    }
  }
  return names
}

async function provideMCXHover(
  document: TextDocument,
  position: Position
): Promise<Hover | undefined> {
  const linePrefix = document
    .lineAt(position.line)
    .text.slice(0, position.character)
  const hoverInfo = await analyzeHoverPosition(document, position, linePrefix)

  if (!hoverInfo) {
    return undefined
  }

  const markdown = new MarkdownString()
  markdown.isTrusted = true

  if (hoverInfo.type === 'tag' && hoverInfo.tagName) {
    markdown.appendCodeblock(hoverInfo.tagName, 'xml')
    markdown.appendMarkdown('\n\n**MCX Tag**\n\n')

    const tagDocs: Record<string, string> = {
      script: 'Script block for embedded TypeScript/JavaScript code.\n\n**Attributes:** `lang`, `id`, `@before`, `@after`\n**Languages:** `ts`, `js`',
      Event: 'Event definition block for Minecraft event handlers.\n\nDefines event-driven behavior using Minecraft events.\n\n**Attributes:** `id`, `@before`, `@after`\n\n**Contents:** Subscribe to events with `subscribe("eventName", handler)`.',
      Component: 'Component definition block.\n\nDefines a reusable component with custom items, blocks, entities, features, feature rules, spawn rules, and recipes.\n\n**Attributes:** `id`\n\n**Children:** `<items>`, `<blocks>`, `<entities>`, `<features>`, `<featureRules>`, `<spawnRules>`, `<recipes>`, `<itemCatalog>`',
      Ui: 'UI definition block.\n\nDefines a reactive CustomForm-based UI layout.\n\n**Attributes:** `id`, `setup`\n\n**Children:** `input`, `textField`, `toggle`, `dropdown`, `slider`, `button`, `label`, `body`, `header`, `title`, `divider`, `spacer`, `close-button`',
      Form: 'Form definition block.\n\nDefines a legacy FormData-based UI (ModalFormData/ActionFormData/MessageFormData).\n\n**Attributes:** `id`, `type` (`modal`/`action`/`message`)',
      items: 'Item definitions container.\n\nWraps one or more `<item>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      blocks: 'Block definitions container.\n\nWraps one or more `<block>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      entities: 'Entity definitions container.\n\nWraps one or more `<entity>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      features: 'Feature definitions container.\n\nWraps one or more `<feature>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      featureRules: 'Feature rule definitions container.\n\nWraps one or more `<featureRule>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      spawnRules: 'Spawn rule definitions container.\n\nWraps one or more `<spawnRule>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      recipes: 'Recipe definitions container.\n\nWraps one or more `<recipe>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      itemCatalog: 'Item catalog definitions container.\n\nWraps one or more `<itemCatalog>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      item: 'Custom item definition.\n\nDefines a custom Minecraft item with properties.\n\n**Attributes:** `id`, `@before`, `@after`',
      block: 'Custom block definition.\n\nDefines a custom Minecraft block with properties.\n\n**Attributes:** `id`, `@before`, `@after`',
      entity: 'Custom entity definition.\n\nDefines a custom Minecraft entity with properties.\n\n**Attributes:** `id`, `@before`, `@after`',
      feature: 'Custom feature definition.\n\nDefines a Minecraft feature (e.g., ore_feature) with properties.\n\n**Attributes:** `id`, `@before`, `@after`',
      featureRule: 'Custom feature rule definition.\n\nDefines a feature rule with placement conditions.\n\n**Attributes:** `id`, `@before`, `@after`',
      spawnRule: 'Custom spawn rule definition.\n\nDefines spawn conditions for entities.\n\n**Attributes:** `id`, `@before`, `@after`',
      recipe: 'Custom recipe definition.\n\nDefines a crafting recipe.\n\n**Attributes:** `id`, `@before`, `@after`',
      input: 'Text input field.\n\n**Attributes:** `placeholderText`, `default`, `value`, `tip`, `disabled`, `visible`',
      textField: 'Text input field (alias for `input`).\n\n**Attributes:** `placeholderText`, `default`, `value`, `tip`, `disabled`, `visible`',
      toggle: 'Toggle/switch control.\n\n**Attributes:** `default`, `value`, `tip`, `disabled`, `visible`',
      dropdown: 'Dropdown selection menu.\n\n**Attributes:** `default`, `option`, `value`, `tip`, `disabled`, `visible`',
      slider: 'Slider control.\n\n**Attributes:** `default`, `min`, `max`, `value`, `tip`, `disabled`, `visible`',
      button: 'Action button.\n\n**Attributes:** `click`, `img`, `tip`, `disabled`, `visible`',
      submit: 'Submit button (Form mode only).\n\n**Attributes:** `click`, `tip`, `disabled`, `visible`',
      'button-m': 'Message form button (Form mode only, max 2).\n\n**Attributes:** `click`, `tip`, `disabled`, `visible`',
      label: 'Static text label.\n\n**Attributes:** `tip`, `disabled`, `visible`',
      body: 'Static text body (alias for `label`).\n\n**Attributes:** `tip`, `disabled`, `visible`',
      header: 'Section header.\n\n**Attributes:** `tip`, `disabled`, `visible`',
      title: 'Form title.\n\n**Attributes:** `tip`, `disabled`, `visible`',
      divider: 'Horizontal divider.\n\n**Attributes:** `tip`, `disabled`, `visible`',
      spacer: 'Vertical spacer.\n\n**Attributes:** `tip`, `disabled`, `visible`',
      'close-button': 'Form close button.\n\nNo content attributes.',
    }

    if (tagDocs[hoverInfo.tagName]) {
      markdown.appendMarkdown(tagDocs[hoverInfo.tagName])
    } else {
      markdown.appendMarkdown('MCX custom tag\n\nThis tag does not have built-in documentation.')
    }
  }

  if (hoverInfo.type === 'attribute' && hoverInfo.attrName) {
    markdown.appendCodeblock(hoverInfo.attrName, 'xml')
    markdown.appendMarkdown('\n\n**MCX Attribute**\n\n')

    const attrDocs: Record<string, string> = {
      id: 'Unique identifier for referencing this element from script code or other tags.',
      lang: 'Script language specification for the `<script>` block.\n\n**Values:** `ts` (TypeScript, default), `js` (JavaScript)',
      '@before': 'Event hook: executes the specified script code **before** the main logic runs.\n\nUseful for setup, validation, or preprocessing steps.',
      '@after': 'Event hook: executes the specified script code **after** the main logic runs.\n\nUseful for cleanup, logging, or post-processing steps.',
      setup: 'Marks the UI/Form as a setup-mode component. When present, the script block\'s return value is used as the setup context, and `defineProp()` macros are enabled.',
      type: 'For `<Form>` tag: explicitly set the form type.\n\n**Values:** `modal` (ModalFormData), `action` (ActionFormData), `message` (MessageFormData)',
      click: 'Click handler function name. The function is called when the button is clicked, receiving the player as an argument.',
      ':click': 'Dynamic click handler expression.',
      default: 'Default value for the form element.',
      ':default': 'Dynamic default value expression.',
      ':value': 'Dynamic value binding expression.',
      option: 'Dropdown options. Comma-separated string or array expression.',
      ':option': 'Dynamic dropdown options expression.',
      min: 'Slider minimum value.',
      ':min': 'Dynamic slider minimum expression.',
      max: 'Slider maximum value.',
      ':max': 'Dynamic slider maximum expression.',
      placeholderText: 'Input placeholder text.',
      ':placeholderText': 'Dynamic placeholder text expression.',
      tip: 'Tooltip text shown on hover.',
      ':tip': 'Dynamic tooltip expression.',
      disabled: 'Disables the form element.',
      ':disabled': 'Dynamic disabled expression.',
      visible: 'Controls element visibility.',
      ':visible': 'Dynamic visibility expression.',
      description: 'Description text for the element.',
      ':description': 'Dynamic description expression.',
      img: 'Button image path (Form mode only).',
    }

    if (attrDocs[hoverInfo.attrName]) {
      markdown.appendMarkdown(attrDocs[hoverInfo.attrName])
    }

    if (hoverInfo.attrValue) {
      markdown.appendMarkdown(`\n**Value:** \`${hoverInfo.attrValue}\``)
    }
  }

  return new Hover(markdown, hoverInfo.range)
}

interface HoverInfo {
  type: 'tag' | 'attribute'
  range?: Range
  tagName?: string
  attrName?: string
  attrValue?: string
}

async function analyzeHoverPosition(
  document: TextDocument,
  position: Position,
  linePrefix: string
): Promise<HoverInfo | undefined> {
  const script = await getScriptBlock(document.getText())
  if (script && isInsideScriptBlock(document, position, script)) {
    return undefined
  }

  const fullLine = document.lineAt(position.line).text
  const cursorChar = position.character

  const ltIndex = fullLine.lastIndexOf('<', cursorChar)
  if (ltIndex !== -1) {
    const afterLt = fullLine.slice(ltIndex + 1)
    const tagNameMatch = afterLt.match(/^\/?([A-Za-z][\w:-]*)/)
    if (tagNameMatch) {
      const tagName = tagNameMatch[1]
      const isClosing = afterLt.startsWith('/')
      const tagNameStart = ltIndex + 1 + (isClosing ? 1 : 0)
      const tagNameEnd = tagNameStart + tagName.length

      if (cursorChar >= tagNameStart && cursorChar <= tagNameEnd) {
        const tagRange = new Range(
          new Position(position.line, tagNameStart),
          new Position(position.line, tagNameEnd),
        )
        return {
          type: 'tag',
          range: tagRange,
          tagName,
        }
      }
    }
  }

  if (isInsideOpenTag(linePrefix)) {
    const wordRange = getWordRangeAtPosition(document, position)
    if (wordRange) {
      const word = fullLine.slice(
        wordRange.start.character,
        wordRange.end.character,
      )
      if (wordRange.start.character > 0) {
        const charBefore = fullLine[wordRange.start.character - 1]

        if (charBefore === ' ' || charBefore === '\t') {
          const restOfLine = fullLine.slice(wordRange.end.character)
          const valueMatch = restOfLine.match(
            /^\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/,
          )
          const attrValue =
            valueMatch?.[1] || valueMatch?.[2] || valueMatch?.[3]
          return {
            type: 'attribute',
            range: wordRange,
            attrName: word,
            attrValue,
          }
        }

        if (charBefore === '=' || charBefore === '"' || charBefore === "'") {
          const beforeEquals = fullLine.slice(0, wordRange.start.character)
          const valueAttrMatch = beforeEquals.match(/([\w@:-]+)\s*=\s*["']?$/)
          if (valueAttrMatch) {
            return {
              type: 'attribute',
              range: wordRange,
              attrName: valueAttrMatch[1],
              attrValue: word,
            }
          }
        }
      }
    }
  }

  return undefined
}

async function provideMCXDefinition(
  document: TextDocument,
  position: Position,
  _token: CancellationToken,
): Promise<Definition | DefinitionLink[] | undefined> {
  const source = document.getText()
  const offset = document.offsetAt(position)

  const { tags } = await getCachedAST(source)
  const eventTag = tags.find(t => t.name === 'Event')
  if (!eventTag) return undefined

  const lineOffsets = computeLineOffsets(source)
  const eventContentRange = getTagContentRangeRaw(source, eventTag, lineOffsets)
  if (!eventContentRange) return undefined

  if (offset < eventContentRange.start || offset > eventContentRange.end) {
    return undefined
  }

  const eventContent = source.slice(eventContentRange.start, eventContentRange.end)
  const lineStart = source.lastIndexOf('\n', offset - 1)
  const lineStartOffset = lineStart === -1 ? 0 : lineStart + 1
  const lineEnd = source.indexOf('\n', offset)
  const lineEndOffset = lineEnd === -1 ? source.length : lineEnd
  const currentLine = source.slice(lineStartOffset, lineEndOffset)
  const eqIndex = currentLine.indexOf('=')
  if (eqIndex === -1) return undefined

  const colInLine = offset - lineStartOffset
  const valueStart = eqIndex + 1
  if (colInLine < valueStart) return undefined

  const valueMatch = currentLine.slice(valueStart).match(/(\w+)/)
  if (!valueMatch) return undefined

  const valueStr = valueMatch[1]
  const valueColStart = lineStartOffset + valueStart + valueMatch.index!
  if (offset < valueColStart || offset > valueColStart + valueStr.length) {
    return undefined
  }

  const script = await getScriptBlock(source)
  if (!script) return undefined

  const scriptSource = source.slice(script.start, script.end)
  const funcRegex = new RegExp(
    `(?:export\\s+)?(?:function|const|let|var)\\s+${escapeRegex(valueStr)}\\b`,
  )
  const funcMatch = funcRegex.exec(scriptSource)
  if (!funcMatch) return undefined

  const funcOffset = script.start + funcMatch.index
  const funcLine = source.slice(0, funcOffset).split('\n').length - 1
  const funcCol = funcOffset - source.lastIndexOf('\n', funcOffset - 1) - 1

  return new Location(
    document.uri,
    new Range(
      new Position(funcLine, funcCol),
      new Position(funcLine, funcCol + valueStr.length),
    ),
  )
}

function getTagContentRangeRaw(
  source: string,
  tag: MCXTagNode,
  lineOffsets: number[],
): { start: number; end: number } | null {
  if (!tag.start || !tag.start.start) return null
  const startOffset = offsetAt(lineOffsets, tag.start.start)
  const startTagEnd = Math.min(
    source.length,
    startOffset + (tag.start.data?.length ?? 0),
  )
  let endTagStart = startTagEnd
  if (tag.end?.start) {
    endTagStart = offsetAt(lineOffsets, tag.end.start)
  }
  if (endTagStart < startTagEnd) endTagStart = startTagEnd
  return {
    start: startTagEnd,
    end: Math.min(source.length, endTagStart),
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function getScriptBlock(
  source: string
): Promise<{ start: number; end: number } | undefined> {
  let parsed: MCXTagNode[] | undefined
  try {
    const core = await loadMcx()
    parsed = new (core as any).AST.tag(source).parseAST() as MCXTagNode[]
  } catch {
    return undefined
  }

  const scriptTag = parsed.find(node => node.name === 'script')
  if (!scriptTag) {
    return undefined
  }

  const lineOffsets = computeLineOffsets(source)
  const start =
    offsetAt(lineOffsets, scriptTag.start.start) + scriptTag.start.data.length
  const end = scriptTag.end?.start
    ? offsetAt(lineOffsets, scriptTag.end.start)
    : start

  return { start, end }
}

function isInsideScriptBlockContent(
  document: TextDocument,
  position: Position,
  script: { start: number; end: number },
): boolean {
  const offset = document.offsetAt(position)
  return offset >= script.start && offset <= script.end
}

function isInsideScriptBlock(
  document: TextDocument,
  position: Position,
  script: { start: number; end: number },
): boolean {
  const offset = document.offsetAt(position)
  return offset >= script.start && offset <= script.end
}

function isInsideOpenTag(linePrefix: string): boolean {
  const lt = linePrefix.lastIndexOf('<')
  const gt = linePrefix.lastIndexOf('>')
  return lt > gt
}

function currentTagName(linePrefix: string): string | undefined {
  const match = linePrefix.match(/<([A-Za-z][\w:-]*)[^>]*$/)
  return match?.[1]
}

function isCompletingScriptLang(linePrefix: string): boolean {
  const tag = currentTagName(linePrefix)
  if (tag !== 'script') {
    return false
  }
  return /\blang\s*=\s*(?:"[^"]*|'[^']*|[^\s>]*)?$/.test(linePrefix)
}

function computeLineOffsets(text: string): number[] {
  const offsets = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1)
    }
  }
  return offsets
}

function offsetAt(lineOffsets: number[], position: MCXPosition): number {
  const lineIndex = Math.max(
    0,
    Math.min(lineOffsets.length - 1, position.line - 1),
  )
  return lineOffsets[lineIndex] + Math.max(0, position.column)
}

function getWordRangeAtPosition(
  document: TextDocument,
  position: Position,
): Range | undefined {
  const line = document.lineAt(position.line)
  const lineText = line.text

  let start = position.character
  let end = position.character

  while (start > 0 && /[\w@:-]/.test(lineText[start - 1])) {
    start--
  }

  while (end < lineText.length && /[\w@:-]/.test(lineText[end])) {
    end++
  }

  if (start < end) {
    return new Range(
      new Position(position.line, start),
      new Position(position.line, end),
    )
  }

  return undefined
}
