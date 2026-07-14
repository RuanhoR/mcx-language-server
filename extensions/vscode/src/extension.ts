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
import * as mcx from '@mbler/mcx-core'
import type { LanguageClient } from 'vscode-languageclient/node.js'
import { createMCXLanguageClient } from './client/index.js'
import { formatMCXDocument } from './format/index.js'

type MCXPosition = mcx.PubType.MCXPosition
type MCXTagNode = mcx.PubType.ParsedTagNode

const TAG_COMPLETIONS = ['script', 'Event', 'Component', 'Ui']
const SCRIPT_LANG_VALUES = ['ts', 'js']
const UI_LAYOUT_TYPES = ['input', 'dropdown', 'submit', 'toggle', 'slider', 'button-m', 'button', 'divider', 'title', 'body']
const COMPONENT_PARENT_TAGS = ['items', 'blocks', 'entities']
const COMPONENT_CHILD_TAGS = ['item', 'block', 'entity']
const TS_PLUGIN_ID = '@mbler/mcx-ts-plugin'
let client: LanguageClient | undefined
patchTypeScriptExtension()

const astCache = new Map<string, { tags: MCXTagNode[]; compileData: any; timestamp: number }>()
const AST_CACHE_TTL = 500

function getCachedAST(source: string): { tags: MCXTagNode[]; compileData: any } {
  const cached = astCache.get(source)
  const now = Date.now()
  if (cached && now - cached.timestamp < AST_CACHE_TTL) {
    return cached
  }
  let tags: MCXTagNode[] = []
  let compileData: any = undefined
  try {
    tags = new (mcx as any).AST.tag(source).parseAST() as MCXTagNode[]
  } catch {}
  try {
    compileData = (mcx as any).compiler.compileMCXFn(source)
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
  console.error("[MCX] Extension activating...");
  client = createMCXLanguageClient(context);
  console.error("[MCX] Starting language client...");
  client.start().then(() => {
    console.error("[MCX] Language client ready");
  }).catch((e) => {
    console.error("[MCX] Language client failed to start:", e);
    window.showErrorMessage(`MCX language server failed to start: ${e.message}`);
  });
  void configureTypeScriptPlugin();

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

  workspace.onDidSaveTextDocument(document => {
    if (document.languageId === 'mcx' || document.languageId === 'typescript' || document.languageId === 'javascript' || document.languageId === 'json' || document.languageId === 'jsonc') {
      client?.sendNotification('workspace/didChangeWatchedFiles', {
        changes: [{ uri: document.uri.toString(), type: 2 }],
      })
      // Redundant safety net: ensures project refresh even if Volar's file watcher
      // chain drops the workspace/didChangeWatchedFiles notification
      client?.sendNotification('mcx/fileChanged', { uri: document.uri.toString() })
    }
  })
}

export async function deactivate(): Promise<void> {
  if (!client) {
    return
  }

  await client.stop()
  client = undefined
}

function patchTypeScriptExtension(): boolean {
  const tsExtension = extensions.getExtension('vscode.typescript-language-features')
  if (!tsExtension) {
    return false
  }

  const fs = require('node:fs') as typeof import('node:fs')
  const child_process = require('node:child_process') as typeof import('node:child_process')
  const { publisher, name } = require('../package.json') as { publisher: string; name: string }
  const mcxExtension = extensions.getExtension(`${publisher}.${name}`)
  const tsPluginName = '@mbler/mcx-ts-plugin'

  if (mcxExtension) {
    mcxExtension.packageJSON.contributes.typescriptServerPlugins = [
      {
        name: tsPluginName,
        enableForWorkspaceTypeScriptVersions: true,
        configNamespace: 'typescript',
      },
    ]
  }

  if (!tsExtension.isActive) {
    const extensionJsPath = (require as any).resolve('./dist/extension.js', { paths: [tsExtension.extensionPath] })
    const origReadFileSync = fs.readFileSync as (...args: any[]) => any
    ;(fs as any).readFileSync = (...args: any[]) => {
      if (args[0] === extensionJsPath) {
        let text = origReadFileSync(...args) as string

        const id = String.raw`[\w$]+(?:\.[\w$]+)?`

        text = text.replace(
          new RegExp(
            String.raw`(\.jsTsLanguageModes=\[${id},${id},${id},${id}\])|("javascriptreact",(${id})=\[(${id},${id},${id},${id})\])`,
          ),
          (_match: string, oldFormat: string, _newFull: string, newLhs: string, newElements: string) => {
            if (oldFormat) {
              return oldFormat + '.concat("mcx")'
            }
            return `"javascriptreact",${newLhs}=[${newElements}].concat("mcx")`
          },
        )
        text = text.replace(
          new RegExp(String.raw`\.languages\.match\(\[(${id},${id},${id},${id})\]`),
          (_: string, ids: string) => `.languages.match([${ids}].concat("mcx")`,
        )
        text = text.replace(
          new RegExp(String.raw`\.languages\.match\(\[(${id},${id})\]`),
          (_: string, ids: string) => `.languages.match([${ids}].concat("mcx")`,
        )
        text = text.replace(
          new RegExp(String.raw`registerExtensionLanguageProvider\((${id}),${id}\)\{`),
          (match: string, id: string) => `${match}if(${id}.languageIds.includes("mcx"))${id}.standardFileExtensions.push("mcx");`,
        )
        text = text.replace(
          new RegExp(String.raw`.RelativePattern\(${id},"\*\*\/\*\.\{ts,tsx,js,jsx`),
          (match: string) => `${match},mcx`,
        )
        text = text.replace(
          new RegExp(String.raw`"--globalPlugins",(${id})\.plugins`),
          (s: string) => s + `.sort((a,b)=>(b.name==="${tsPluginName}"?-1:0)-(a.name==="${tsPluginName}"?-1:0))`,
        )

        return text
      }
      return origReadFileSync(...args)
    }

    const loadedModule = (require as any).cache[extensionJsPath]
    if (loadedModule) {
      delete (require as any).cache[extensionJsPath]
      const patchedModule = require(extensionJsPath)
      Object.assign(loadedModule.exports, patchedModule)
    }
  }

  const origSpawn = child_process.spawn as (...args: any[]) => any
  ;(child_process as any).spawn = (...args: any[]) => {
    if (Array.isArray(args[1])) {
      const index = args[1].findIndex((arg: any) => typeof arg === 'string' && isTsserverFile(arg))
      if (index !== -1) {
        args[1][index] = transformTsserver(args[1][index])
      }
    }
    return origSpawn(...args)
  }

  const origFork = child_process.fork as (...args: any[]) => any
  ;(child_process as any).fork = (...args: any[]) => {
    if (typeof args[0] === 'string' && isTsserverFile(args[0])) {
      args[0] = transformTsserver(args[0])
    }
    return origFork(...args)
  }

  function isTsserverFile(file: string) {
    return path.isAbsolute(file) && path.basename(file) === 'tsserver.js'
  }

  function transformTsserver(serverPath: string) {
    const resolvedServerPath = (require as any).resolve(serverPath, { paths: [path.dirname(serverPath)] })
    const typescriptPath = path.join(path.dirname(resolvedServerPath), 'typescript.js')
    const text = `
      const fs = require('node:fs');
      const readFileSync = fs.readFileSync;
      fs.readFileSync = (...args) => {
        if (args[0] === ${JSON.stringify(typescriptPath)}) {
          let content = readFileSync(...args);
          content = content.replace(
            /supportedTSExtensions = .*(?=;)/,
            s => s + \`.concat([".mcx"])\`,
          );
          content = content.replace(
            /supportedJSExtensions = .*(?=;)/,
            s => s + \`.concat([".mcx"])\`,
          );
          content = content.replace(
            /allSupportedExtensions = .*(?=;)/,
            s => s + \`.concat([".mcx"])\`,
          );
          content = content.replace(
            /function changeExtension\\(/,
            s => \`function changeExtension(path, newExtension) {
              return [".mcx"].some(ext => path.endsWith(ext))
              ? path + newExtension
              : _changeExtension(path, newExtension);
            }\n\` + s.replace("changeExtension", "_changeExtension"),
          );
          content = content.replace(
            /const isJs = hasJSFileExtension\\((.*?)\\.fileName\\)/,
            (s, file) => \`const isJs = isSourceFileJS(\${file})\`,
          );
          return content;
        }
        return readFileSync(...args);
      };
      require(${JSON.stringify(resolvedServerPath)});
    `
    try {
      const proxyPath = path.join(__dirname, 'tsserver.js')
      fs.writeFileSync(proxyPath, text)
      return proxyPath
    }
    catch {
      return serverPath
    }
  }

  return true
}

async function restartLanguageServer(context: ExtensionContext): Promise<void> {
  if (client) {
    await client.stop()
    client = undefined
  }

  client = createMCXLanguageClient(context)
  try {
    await client.start()
    await configureTypeScriptPlugin()
    window.showInformationMessage('MCX language server restarted successfully.')
  } catch (e) {
    window.showErrorMessage(`MCX language server restart failed: ${(e as Error).message}`)
  }
}

async function configureTypeScriptPlugin(): Promise<void> {
  const tsExtension = extensions.getExtension(
    'vscode.typescript-language-features',
  )
  if (!tsExtension) {
    return
  }

  await tsExtension.activate()

  const api = (
    tsExtension.exports as { getAPI?: (version: number) => any } | undefined
  )?.getAPI?.(0)
  if (!api || typeof api.configurePlugin !== 'function') {
    return
  }

  api.configurePlugin(TS_PLUGIN_ID, {
    enabled: true,
    extension: 'mcx',
  })
}

async function ensureMCXLanguage(document: TextDocument): Promise<void> {
  if (!document.uri.fsPath.endsWith('.mcx')) {
    return
  }
  if (document.languageId === 'plaintext') {
    try {
      await languages.setTextDocumentLanguage(document, 'mcx')
    } catch {
      // not a plaintext document
    }
  }
}

function getParentTagContext(
  document: TextDocument,
  position: Position,
): string | undefined {
  const source = document.getText()
  const offset = document.offsetAt(position)
  const beforeCursor = source.slice(0, offset)
  const tags = beforeCursor.match(/<([A-Za-z][\w:-]*)[^>]*>/g)
  if (!tags) return undefined
  const openStack: string[] = []
  for (const tag of tags) {
    if (tag.startsWith('</')) {
      const name = tag.match(/<\/([\w:-]+)/)?.[1]
      if (name && openStack.length > 0 && openStack[openStack.length - 1] === name) {
        openStack.pop()
      }
    } else if (!tag.endsWith('/>')) {
      const name = tag.match(/<([\w:-]+)/)?.[1]
      if (name) openStack.push(name)
    }
  }
  return openStack.length > 0 ? openStack[openStack.length - 1] : undefined
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
    case 'Ui':
      return UI_LAYOUT_TYPES
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

function provideMCXCompletions(
  document: TextDocument,
  position: Position,
): CompletionItem[] {
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
    return suggestions.map(name => {
      const item = new CompletionItem(name, CompletionItemKind.Keyword)
      item.insertText = name
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

  const scriptBlock = getScriptBlock(document.getText())
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
  } else if (UI_LAYOUT_TYPES.includes(tagName)) {
    addAttr('content', 'UI element content')
    addAttr('click', 'Click handler')
    addAttr('img', 'Button image path')
    addAttr('default', 'Default value')
    addAttr('option', 'Dropdown options (comma-separated)')
    addAttr('min', 'Slider minimum value')
    addAttr('max', 'Slider maximum value')
    addAttr('placeholderText', 'Input placeholder text')
    addAttr('tip', 'Tooltip text')
    addAttr('for', 'For loop expression (e.g. "item in items")')
    addAttr('if', 'Conditional expression')
  } else {
    addAttr('@before', 'Execute before main logic')
    addAttr('@after', 'Execute after main logic')
  }

  return items
}

function provideScriptCompletions(
  document: TextDocument,
  position: Position,
  fullLine: string,
  linePrefix: string,
): CompletionItem[] {
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
    const { tags } = getCachedAST(source)
    const eventTag = tags.find(t => t.name === 'Event')
    if (eventTag) {
      const eventOn = typeof eventTag.arr['@before'] === 'string' ? 'before' : 'after'
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

function provideMCXHover(
  document: TextDocument,
  position: Position,
): Hover | undefined {
  const linePrefix = document
    .lineAt(position.line)
    .text.slice(0, position.character)
  const hoverInfo = analyzeHoverPosition(document, position, linePrefix)

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
      Component: 'Component definition block.\n\nDefines a reusable component with custom items, blocks, and entities.\n\n**Attributes:** `id`\n\n**Children:** `<items>`, `<blocks>`, `<entities>`',
      Ui: 'UI definition block.\n\nDefines a custom UI layout for Minecraft.\n\n**Attributes:** `id`\n\n**Children:** `input`, `dropdown`, `submit`, `toggle`, `slider`, `button`, `button-m`, `divider`, `title`, `body`',
      items: 'Item definitions container.\n\nWraps one or more `<item>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      blocks: 'Block definitions container.\n\nWraps one or more `<block>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      entities: 'Entity definitions container.\n\nWraps one or more `<entity>` definitions in a Component.\n\n**Attributes:** `id`, `@before`, `@after`',
      item: 'Custom item definition.\n\nDefines a custom Minecraft item with properties.\n\n**Attributes:** `id`, `@before`, `@after`',
      block: 'Custom block definition.\n\nDefines a custom Minecraft block with properties.\n\n**Attributes:** `id`, `@before`, `@after`',
      entity: 'Custom entity definition.\n\nDefines a custom Minecraft entity with properties.\n\n**Attributes:** `id`, `@before`, `@after`',
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

function analyzeHoverPosition(
  document: TextDocument,
  position: Position,
  linePrefix: string,
): HoverInfo | undefined {
  const script = getScriptBlock(document.getText())
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

function provideMCXDefinition(
  document: TextDocument,
  position: Position,
  _token: CancellationToken,
): Definition | DefinitionLink[] | undefined {
  const source = document.getText()
  const offset = document.offsetAt(position)

  const { tags } = getCachedAST(source)
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
  if (colInLine <= valueStart) return undefined

  const valueMatch = currentLine.slice(valueStart).match(/(\w+)/)
  if (!valueMatch) return undefined

  const valueStr = valueMatch[1]
  const valueColStart = lineStartOffset + valueStart + valueMatch.index!
  if (offset < valueColStart || offset > valueColStart + valueStr.length) {
    return undefined
  }

  const script = getScriptBlock(source)
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

function getScriptBlock(
  source: string,
): { start: number; end: number } | undefined {
  let parsed: MCXTagNode[] | undefined
  try {
    parsed = new (mcx as any).AST.tag(source).parseAST() as MCXTagNode[]
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
