import {
  CompletionItem,
  CompletionItemKind,
  Range,
  SnippetString,
  Uri,
  type Position,
  type TextDocument,
  workspace,
} from 'vscode'
import * as path from 'node:path'
import { getCachedAST, getScriptBlock } from './mcx-ast.js'
import {
  getOpenTagEntries,
  getOpenTagStack,
  getParentTagContext,
  getPartialToken,
  getPartialTokenRange,
  currentTagName,
  isCompletingScriptLang,
  isInsideOpenTag,
  matchesTypedToken,
} from './mcx-text.js'
import {
  ATTR_INFO,
  ROOT_TAGS,
  SUGGESTED_ROOT_TAGS,
  TAG_ATTRIBUTES,
  acceptsChild,
  attributeInsertText,
  getChildTags,
} from './mcx-tags.js'
import {
  MCX_EVENT_DIRECTIVES,
  resolveWorldEventLists,
  type WorldEventLists,
} from './mcx-events.js'

const SCRIPT_LANG_VALUES = ['ts', 'js']

export async function provideMCXCompletions(
  document: TextDocument,
  position: Position,
): Promise<CompletionItem[]> {
  const linePrefix = document
    .lineAt(position.line)
    .text.slice(0, position.character)
  const fullLine = document.lineAt(position.line).text

  // Script content must be checked FIRST: typing `<` inside TypeScript (for
  // example `Array<C`) would otherwise be treated as an MCX tag and offer
  // top-level tag completions like `Component`.
  const scriptBlock = await getScriptBlock(document.getText())
  if (
    scriptBlock &&
    isInsideRange(document, position, scriptBlock)
  ) {
    return provideScriptCompletions(document, position, linePrefix)
  }

  if (/<\/[A-Za-z:_-]*$/.test(linePrefix)) {
    // only what is open *before* the cursor, otherwise a `</` in the middle of
    // the file suggests a tag that is opened further down
    const openTags = getOpenTagStack(
      document.getText().slice(0, document.offsetAt(position)),
    )
    if (openTags.length === 0) return []
    const lastOpen = openTags[openTags.length - 1]!
    if (!matchesTypedToken(lastOpen, getPartialToken(linePrefix))) return []
    const item = new CompletionItem(lastOpen, CompletionItemKind.Keyword)
    item.range = getPartialTokenRange(linePrefix, position)
    item.insertText = lastOpen + '>'
    item.detail = 'Close tag'
    item.filterText = lastOpen
    return [item]
  }

  if (/<[A-Za-z:_-]*$/.test(linePrefix)) {
    const parentContext = getParentTagContext(document, position)
    const suggestions = parentContext
      ? getChildTags(parentContext)
      : SUGGESTED_ROOT_TAGS
    // The trigger char '<' is already in the buffer when this branch matches;
    // inserting `name>$0</name>` right after it yields `<name></name>`.
    // VS Code auto-inserts the matching `>` for `<`, so the cursor usually sits
    // right before an auto-inserted `>`: the completion range must consume it,
    // otherwise accepting a suggestion leaves a stray `>` behind.
    const autoGt = /^>/.test(fullLine.slice(position.character)) ? 1 : 0
    const tokenRange = getPartialTokenRange(linePrefix, position)
    const insertRange = autoGt
      ? new Range(tokenRange.start, tokenRange.end.translate(0, autoGt))
      : tokenRange
    return suggestions
      .filter(name => matchesTypedToken(name, getPartialToken(linePrefix)))
      .map(name => {
        const item = new CompletionItem(name, CompletionItemKind.Keyword)
        item.range = insertRange
        item.insertText = new SnippetString(`${name}>$0</${name}>`)
        item.detail = parentContext ? `${parentContext} child` : 'MCX tag'
        return item
      })
  }

  if (!isInsideOpenTag(linePrefix)) {
    // Not in an open tag: inside an <Event> block this is the `key = handler`
    // position, so offer world event names for the key.
    return provideEventKeyCompletions(document, position, linePrefix)
  }

  // Completing in the middle of a token would duplicate the tail (`@after` ->
  // `@after@after`); only offer when the cursor sits at the end of the tag.
  const afterCursor = fullLine.slice(position.character)
  if (afterCursor && !/^\s*\/?>/.test(afterCursor)) {
    return []
  }

  if (isCompletingScriptLang(linePrefix)) {
    const typed = getPartialToken(linePrefix)
    return SCRIPT_LANG_VALUES.filter(lang =>
      matchesTypedToken(lang, typed),
    ).map(lang => {
      const item = new CompletionItem(lang, CompletionItemKind.EnumMember)
      item.range = getPartialTokenRange(linePrefix, position)
      item.insertText = lang
      item.detail = 'script lang'
      return item
    })
  }

  const tagName = currentTagName(linePrefix)
  if (!tagName) return []

  const containers = getOpenTagEntries(
    document,
    document.offsetAt(position),
  ).map(entry => entry.name)
  return getAttributeCompletions(tagName, linePrefix, position, containers)
}

function isInsideRange(
  document: TextDocument,
  position: Position,
  range: { start: number; end: number },
): boolean {
  const offset = document.offsetAt(position)
  return offset >= range.start && offset <= range.end
}

async function provideScriptCompletions(
  document: TextDocument,
  position: Position,
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
      const events = (await resolveProjectEventLists(document))[eventOn]
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

/**
 * Key completions for `<Event>` block content: one `eventName = handler` per
 * line, so at the key position offer the world event names of the configured
 * side (`@before` / `@after`, default `after`) plus the `McxExtendsBy`
 * directive. Names come from the project's own @minecraft/server when present.
 */
async function provideEventKeyCompletions(
  document: TextDocument,
  position: Position,
  linePrefix: string,
): Promise<CompletionItem[]> {
  const offset = document.offsetAt(position)
  const entries = getOpenTagEntries(document, offset)
  const last = entries[entries.length - 1]
  if (!last || last.name !== 'Event') return []

  // Key position: nothing structural on the line yet (`playerBreakBlock =`
  // already has its key; `<` means a tag, not a key).
  if (linePrefix.includes('<') || linePrefix.includes('=')) return []

  const source = document.getText()
  const { tags } = await getCachedAST(source)
  const eventTag = tags.find(t => t.name === 'Event')
  const on = typeof eventTag?.arr?.['@before'] === 'string' ? 'before' : 'after'

  const lists = await resolveProjectEventLists(document)
  const typed = getPartialToken(linePrefix)
  const range = getPartialTokenRange(linePrefix, position)

  const items: CompletionItem[] = []
  for (const name of lists[on]) {
    if (!matchesTypedToken(name, typed)) continue
    const item = new CompletionItem(name, CompletionItemKind.Event)
    item.range = range
    item.filterText = name
    item.insertText = `${name} = `
    item.detail = `world.${on}Events event`
    items.push(item)
  }
  for (const directive of MCX_EVENT_DIRECTIVES) {
    if (!matchesTypedToken(directive, typed)) continue
    const item = new CompletionItem(directive, CompletionItemKind.Keyword)
    item.range = range
    item.filterText = directive
    item.insertText = `${directive} = `
    item.detail = 'Pull bindings from another .mcx file'
    items.push(item)
  }
  return items
}

/** World event lists for the document's project, with a per-document cache. */
const eventListsCache = new Map<string, WorldEventLists>()

async function resolveProjectEventLists(
  document: TextDocument,
): Promise<WorldEventLists> {
  const cached = eventListsCache.get(document.uri.fsPath)
  if (cached) return cached

  const readFile = async (p: string): Promise<string> =>
    new TextDecoder().decode(await workspace.fs.readFile(Uri.file(p)))
  const roots: string[] = []
  const docFolder = workspace.getWorkspaceFolder(document.uri)
  if (docFolder) roots.push(docFolder.uri.fsPath)
  for (const folder of workspace.workspaceFolders ?? []) {
    if (!roots.includes(folder.uri.fsPath)) roots.push(folder.uri.fsPath)
  }

  const lists = await resolveWorldEventLists(readFile, roots, path.join)
  eventListsCache.set(document.uri.fsPath, lists)
  return lists
}

/** Attributes already written in the open tag the cursor sits in. */
function getUsedAttributes(linePrefix: string): Set<string> {
  const insideTag = linePrefix.slice(linePrefix.lastIndexOf('<'))
  // drop quoted values first, otherwise `id="my item"` registers `item`
  const withoutValues = insideTag.replace(/"[^"]*"?|'[^']*'?/g, ' ')
  const used = new Set<string>()
  for (const match of withoutValues.matchAll(/(?:^|\s)([@:]?[\w-]+)/g)) {
    const token = match[1]
    if (token) used.add(token)
  }
  return used
}

function attributeKind(name: string): CompletionItemKind {
  if (name.startsWith('@')) return CompletionItemKind.Keyword
  if (name.startsWith(':')) return CompletionItemKind.Field
  return CompletionItemKind.Property
}

/** True when `tagName` is valid at the cursor, given the enclosing tag chain. */
function isValidPlacement(containers: string[], tagName: string): boolean {
  if (containers.length === 0) return ROOT_TAGS.includes(tagName)
  return containers.some(parent => acceptsChild(parent, tagName))
}

/**
 * Attributes accepted by `tagName` at the cursor, taken from the compiler's own
 * tables (`./mcx-tags.ts`) — a tag in the wrong place gets nothing rather than
 * a generic list.
 */
function getAttributeCompletions(
  tagName: string,
  linePrefix: string,
  position: Position,
  containers: string[],
): CompletionItem[] {
  if (!isValidPlacement(containers, tagName)) return []
  const allowed = TAG_ATTRIBUTES[tagName]
  if (!allowed || allowed.length === 0) return []

  const typed = getPartialToken(linePrefix)
  const range = getPartialTokenRange(linePrefix, position)
  const used = getUsedAttributes(linePrefix)
  const items: CompletionItem[] = []
  for (const name of allowed) {
    if (used.has(name) || !matchesTypedToken(name, typed)) continue
    const item = new CompletionItem(name, attributeKind(name))
    item.range = range
    item.filterText = name
    item.insertText = attributeInsertText(name)
    item.detail = ATTR_INFO[name]?.summary ?? 'MCX attribute'
    items.push(item)
  }
  return items
}
