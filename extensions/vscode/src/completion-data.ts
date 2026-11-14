import type { LanguageClient } from 'vscode-languageclient/node.js'
import {
  ATTR_INFO,
  CONTAINER_TAGS,
  SUGGESTED_ROOT_TAGS,
  TAG_ATTRIBUTES,
  attributeInsertText,
  getChildTags,
} from './mcx-tags.js'

/**
 * Plugin completion data, fetched from the MCX language server.
 *
 * Compiler plugins (`mcxPlugin` → `.mbler/mcx-completion.json`) describe their
 * tags once; mbler writes the manifest, the server merges it with the built-in
 * DSL tables and answers the `mcx/completionData` request with the result. This
 * module caches that answer and layers it over the extension's own tables
 * (`./mcx-tags.ts`), so a `<JsonUi>` tag or `type="jsonui"` completes like any
 * built-in tag.
 *
 * When the request fails (older server, server not started yet) the built-in
 * tables still drive completion — plugin tags simply do not appear.
 */

/** Manifest the server watches; the extension uses it to know when to refresh. */
export const MCX_COMPLETION_MANIFEST = '.mbler/mcx-completion.json'

export interface PluginAttribute {
  name: string
  detail?: string
  insertText?: string
  values?: string[]
  documentation?: string
}

export interface PluginTag {
  name: string
  detail?: string
  children?: string[]
  attributes?: PluginAttribute[]
  container?: boolean
}

/** Plugin contributions, as returned by `mcx/completionData`. */
export interface PluginCompletionData {
  rootTags: string[]
  scriptLangs: string[]
  containers: Set<string>
  tags: Map<string, PluginTag>
}

const EMPTY: PluginCompletionData = {
  rootTags: [],
  scriptLangs: [],
  containers: new Set(),
  tags: new Map(),
}

interface CompletionDataResponse {
  rootTags?: string[]
  scriptLangs?: string[]
  containers?: string[]
  tags?: PluginTag[]
}

let client: LanguageClient | undefined
let cached: PluginCompletionData = EMPTY
let pending: Promise<PluginCompletionData> | undefined

/** Register the client whose server owns the completion data. */
export function setCompletionClient(next: LanguageClient | undefined): void {
  client = next
  cached = EMPTY
}

/**
 * Fetch (and cache) the merged completion data. `force` asks the server to
 * re-read the manifest, e.g. after mbler rewrote it.
 */
export async function loadPluginCompletionData(
  force = false,
): Promise<PluginCompletionData> {
  if (!client) return cached
  if (!force && cached !== EMPTY) return cached
  if (pending) return pending

  pending = (async () => {
    try {
      const raw = await client!.sendRequest<CompletionDataResponse>(
        'mcx/completionData',
        { refresh: force },
      )
      cached = {
        rootTags: [...(raw.rootTags ?? [])],
        scriptLangs: [...(raw.scriptLangs ?? [])],
        containers: new Set(raw.containers ?? []),
        tags: new Map((raw.tags ?? []).map(tag => [tag.name, tag])),
      }
    } catch {
      // Keep whatever we had: built-in completion stays functional.
    }
    return cached
  })()

  try {
    return await pending
  } finally {
    pending = undefined
  }
}

/** Drop the cache so the next lookup asks the server again. */
export function invalidateCompletionData(): void {
  cached = EMPTY
}

/** Last merged data, without asking the server. */
export function pluginCompletionData(): PluginCompletionData {
  return cached
}

/** Root tags: built-in suggestions first, then plugin contributions. */
export function mergedRootTags(data: PluginCompletionData): string[] {
  const result = [...SUGGESTED_ROOT_TAGS]
  for (const name of data.rootTags) {
    if (!result.includes(name)) result.push(name)
  }
  return result
}

/** Child tags of `parent`, built-in and contributed. */
export function mergedChildTags(
  parent: string,
  data: PluginCompletionData,
): string[] {
  const result = getChildTags(parent)
  for (const name of data.tags.get(parent)?.children ?? []) {
    if (!result.includes(name)) result.push(name)
  }
  return result
}

/** Container tags of both sources. */
export function mergedContainerTags(data: PluginCompletionData): Set<string> {
  // Built-in containers keep their semantics; plugin containers add to them.
  const result = new Set(CONTAINER_TAGS)
  for (const name of data.containers) result.add(name)
  for (const [name, tag] of data.tags) {
    if (tag.container) result.add(name)
  }
  return result
}

/** Attributes of `tag` with plugin contributions merged on top of the DSL. */
export function mergedAttributes(
  tag: string,
  data: PluginCompletionData,
): PluginAttribute[] {
  const builtin = TAG_ATTRIBUTES[tag] ?? []
  const merged: PluginAttribute[] = builtin.map(name => ({
    name,
    detail: ATTR_INFO[name]?.summary ?? 'MCX attribute',
    insertText: attributeInsertText(name),
  }))
  for (const attribute of data.tags.get(tag)?.attributes ?? []) {
    const index = merged.findIndex(item => item.name === attribute.name)
    if (index === -1) merged.push(attribute)
    else merged[index] = { ...merged[index], ...attribute }
  }
  return merged
}

/** Enum values declared for `attribute` on `tag`, if any. */
export function attributeValues(
  tag: string,
  attribute: string,
  data: PluginCompletionData,
): string[] {
  return (
    mergedAttributes(tag, data).find(item => item.name === attribute)?.values ??
    []
  )
}
