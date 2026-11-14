import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MCX_COMPLETION_MANIFEST, readCompletionManifest, serializeCompletionManifest } from './manifest.js'
import type { McxCompletionContribution } from './types.js'

/** Config file names mbler accepts, in resolution order. */
export const MBLER_CONFIG_FILES = [
  'mbler.config.js',
  'mbler.config.mjs',
  'mbler.config.cjs',
] as const

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.mbler',
  '.vscode',
  '.next',
  '.turbo',
])

/** Directories worth descending into while looking for projects. */
const MAX_SCAN_DEPTH = 4
/** Upper bound on projects handled per workspace folder. */
const MAX_PROJECTS = 8

export interface ScanOptions {
  maxDepth?: number
  limit?: number
}

function configIn(dir: string): string | undefined {
  for (const name of MBLER_CONFIG_FILES) {
    const file = path.join(dir, name)
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

/**
 * Every `mbler.config.*` under `root`, nearest first.
 *
 * The config is not necessarily at the workspace root: monorepos keep addons in
 * sub folders, and a workspace folder may hold several of them.
 */
export function findMblerConfigs(root: string, options: ScanOptions = {}): string[] {
  const maxDepth = options.maxDepth ?? MAX_SCAN_DEPTH
  const limit = options.limit ?? MAX_PROJECTS
  const found: string[] = []

  const visit = (dir: string, depth: number): void => {
    if (found.length >= limit || depth > maxDepth) return
    const direct = configIn(dir)
    if (direct) found.push(direct)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= limit) return
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      visit(path.join(dir, entry.name), depth + 1)
    }
  }

  visit(root, 0)
  return found
}

function isContribution(value: unknown): value is McxCompletionContribution {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { name?: unknown }
  return typeof candidate.name === 'string' && candidate.name.length > 0
}

/**
 * `mcxPlugin` may nest arrays and plugin factories; calling a factory once
 * yields the object that carries `completion`. A factory that throws only
 * costs its completions, never the editor session.
 */
function flattenPlugins(value: unknown, out: unknown[], depth = 0): unknown[] {
  if (depth > 4) return out
  if (Array.isArray(value)) {
    for (const item of value) flattenPlugins(item, out, depth + 1)
    return out
  }
  if (typeof value === 'function') {
    try {
      flattenPlugins((value as () => unknown)(), out, depth + 1)
    } catch {
      // ignore factories that refuse to run outside a build
    }
    return out
  }
  if (value && typeof value === 'object') out.push(value)
  return out
}

/**
 * Import `mbler.config.*` and collect the `completion` contributions of the
 * configured compiler plugins. The query string busts Node's module cache, so
 * editing the config or the plugin shows up without restarting the server.
 */
export async function readConfigContributions(
  configPath: string,
): Promise<McxCompletionContribution[]> {
  const url = `${pathToFileURL(configPath).href}?t=${Date.now()}`
  const module = (await import(url)) as { default?: unknown }
  const config = (module.default ?? {}) as {
    script?: { lang?: unknown }
    mcxPlugin?: unknown
  }
  if (config.script?.lang !== 'mcx') return []
  return flattenPlugins(config.mcxPlugin, [])
    .map(plugin => (plugin as { completion?: unknown }).completion)
    .filter(isContribution)
}

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function readManifest(manifestPath: string) {
  return readCompletionManifest(manifestPath, file => {
    try {
      return fs.readFileSync(file, 'utf-8')
    } catch {
      return undefined
    }
  })
}

function writeManifest(
  manifestPath: string,
  contributions: McxCompletionContribution[],
  project: string,
): void {
  try {
    if (contributions.length === 0) {
      fs.rmSync(manifestPath, { force: true })
      return
    }
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
    fs.writeFileSync(
      manifestPath,
      serializeCompletionManifest(contributions, project),
      'utf-8',
    )
  } catch {
    // read-only workspace: keep the in-memory contributions
  }
}

export interface SyncedContributions {
  contributions: McxCompletionContribution[]
  manifestPath: string
  /** project directory the contributions belong to */
  project: string
  /** where the data came from, useful for logs and tests */
  source: 'manifest' | 'config' | 'none'
}

/**
 * Make one project's plugin completions available without running a build.
 *
 * `.mbler/mcx-completion.json` stays the cache every consumer reads, but when
 * it is missing or older than the project's `mbler.config.*`, the contributions
 * are derived from the config with a plain dynamic import and written back with
 * `fs`. The editor's manifest watcher then refreshes completion on its own.
 */
export async function syncProjectCompletions(
  projectDir: string,
  knownConfig?: string,
): Promise<SyncedContributions> {
  const manifestPath = path.join(projectDir, MCX_COMPLETION_MANIFEST)
  const configPath = knownConfig ?? configIn(projectDir)
  const manifest = readManifest(manifestPath)

  if (!configPath) {
    return {
      contributions: manifest?.contributions ?? [],
      manifestPath,
      project: projectDir,
      source: manifest ? 'manifest' : 'none',
    }
  }

  const fresh = manifest !== undefined && mtimeOf(manifestPath) >= mtimeOf(configPath)
  if (fresh) {
    return {
      contributions: manifest.contributions,
      manifestPath,
      project: projectDir,
      source: 'manifest',
    }
  }

  try {
    const contributions = await readConfigContributions(configPath)
    writeManifest(manifestPath, contributions, projectDir)
    return { contributions, manifestPath, project: projectDir, source: 'config' }
  } catch {
    return {
      contributions: manifest?.contributions ?? [],
      manifestPath,
      project: projectDir,
      source: manifest ? 'manifest' : 'none',
    }
  }
}

/**
 * Sync every project under a workspace folder. A workspace folder without any
 * `mbler.config.*` still gets its root manifest read, which keeps the previous
 * build-produced file working.
 */
export async function collectWorkspaceContributions(
  root: string,
): Promise<SyncedContributions[]> {
  const configs = findMblerConfigs(root)
  const results: SyncedContributions[] = []
  const seen = new Set<string>()

  for (const config of configs) {
    const project = path.dirname(config)
    if (seen.has(project)) continue
    seen.add(project)
    try {
      results.push(await syncProjectCompletions(project, config))
    } catch {
      // one broken project must not hide the others
    }
  }

  if (results.length === 0) {
    const legacy = await syncProjectCompletions(root)
    if (legacy.source === 'manifest') results.push(legacy)
  }

  return results
}
