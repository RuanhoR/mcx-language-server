import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectWorkspaceContributions,
  findMblerConfigs,
  readConfigContributions,
  syncProjectCompletions,
  MCX_COMPLETION_MANIFEST,
} from '../src/completion/index.js'

let root = ''

function writeFile(relative: string, source: string): string {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source, 'utf-8')
  return file
}

const CONFIG_WITH_PLUGIN = `export default {
  script: { lang: 'mcx' },
  mcxPlugin: [
    () => ({
      name: 'demo-plugin',
      completion: {
        name: 'demo-plugin',
        rootTags: ['Shop'],
        tags: [{ name: 'Shop', detail: 'Demo shop' }],
      },
    }),
    [{ name: 'inline', completion: { name: 'inline', tags: [{ name: 'Price' }] } }],
    () => {
      throw new Error('factory that only works inside a build')
    },
  ],
};
`

const CONFIG_WITHOUT_PLUGIN = `export default { script: { lang: 'mcx' }, mcxPlugin: [] };
`

const CONFIG_OTHER_PLUGIN = `export default {
  script: { lang: 'mcx' },
  mcxPlugin: [{ name: 'other', completion: { name: 'other', rootTags: ['Only'] } }],
};
`

const CONFIG_NOT_MCX = `export default {
  script: { lang: 'ts' },
  mcxPlugin: [{ name: 'x', completion: { name: 'x' } }],
};
`

const manifestPath = (project: string): string =>
  path.join(project, MCX_COMPLETION_MANIFEST)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcx-completion-config-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('findMblerConfigs', () => {
  it('finds configs in nested projects, not just the workspace root', () => {
    expect(findMblerConfigs(root)).toEqual([])
    const shop = writeFile(path.join('addons', 'shop', 'mbler.config.js'), CONFIG_WITH_PLUGIN)
    const hud = writeFile(path.join('addons', 'hud', 'mbler.config.mjs'), CONFIG_OTHER_PLUGIN)
    expect(findMblerConfigs(root).sort()).toEqual([hud, shop].sort())
  })

  it('skips node_modules, hidden folders and caps the depth', () => {
    writeFile(path.join('node_modules', 'dep', 'mbler.config.js'), CONFIG_WITH_PLUGIN)
    writeFile(path.join('.cache', 'mbler.config.js'), CONFIG_WITH_PLUGIN)
    writeFile(path.join('a', 'b', 'c', 'd', 'e', 'mbler.config.js'), CONFIG_WITH_PLUGIN)
    expect(findMblerConfigs(root)).toEqual([])
  })

  it('honours the project limit', () => {
    for (const name of ['a', 'b', 'c']) {
      writeFile(path.join(name, 'mbler.config.js'), CONFIG_WITH_PLUGIN)
    }
    expect(findMblerConfigs(root, { limit: 2 })).toHaveLength(2)
  })
})

describe('readConfigContributions', () => {
  it('flattens factories, arrays and plain objects, skipping throwing factories', async () => {
    const file = writeFile('mbler.config.js', CONFIG_WITH_PLUGIN)
    const contributions = await readConfigContributions(file)
    expect(contributions.map(item => item.name)).toEqual(['demo-plugin', 'inline'])
    expect(contributions[0]?.rootTags).toEqual(['Shop'])
  })

  it('contributes nothing when the project is not an mcx project', async () => {
    const file = writeFile('mbler.config.js', CONFIG_NOT_MCX)
    expect(await readConfigContributions(file)).toEqual([])
  })

  it('rejects for a config that cannot be imported, so callers can fall back', async () => {
    const file = writeFile('mbler.config.js', 'export default { this is not javascript')
    await expect(readConfigContributions(file)).rejects.toBeTruthy()
  })
})

describe('syncProjectCompletions', () => {
  it('writes the manifest next to the config', async () => {
    const project = path.join(root, 'addons', 'shop')
    const config = writeFile(path.join('addons', 'shop', 'mbler.config.js'), CONFIG_WITH_PLUGIN)
    const synced = await syncProjectCompletions(project, config)
    expect(synced.source).toBe('config')
    expect(synced.contributions).toHaveLength(2)
    expect(synced.project).toBe(project)

    const written = JSON.parse(fs.readFileSync(manifestPath(project), 'utf-8')) as {
      version: number
      contributions: { name: string }[]
    }
    expect(written.version).toBe(1)
    expect(written.contributions.map(item => item.name)).toEqual(['demo-plugin', 'inline'])
  })

  it('reuses the manifest while it is newer than the config', async () => {
    const config = writeFile('mbler.config.js', CONFIG_WITH_PLUGIN)
    expect((await syncProjectCompletions(root, config)).source).toBe('config')
    const second = await syncProjectCompletions(root, config)
    expect(second.source).toBe('manifest')
    expect(second.contributions).toHaveLength(2)
  })

  it('re-derives when the manifest is older than the config', async () => {
    const config = writeFile('mbler.config.js', CONFIG_WITH_PLUGIN)
    await syncProjectCompletions(root, config)
    const future = new Date(Date.now() + 5000)
    fs.utimesSync(config, future, future)
    expect((await syncProjectCompletions(root, config)).source).toBe('config')
  })

  it('keeps the last manifest when the config cannot be imported', async () => {
    writeFile(
      MCX_COMPLETION_MANIFEST,
      '{"version":1,"contributions":[{"name":"cached"}]}',
    )
    const older = new Date(Date.now() - 10000)
    fs.utimesSync(manifestPath(root), older, older)
    writeFile('mbler.config.js', 'export default { broken')
    const synced = await syncProjectCompletions(root)
    expect(synced.source).toBe('manifest')
    expect(synced.contributions.map(item => item.name)).toEqual(['cached'])
  })

  it('drops the manifest when the config contributes nothing', async () => {
    writeFile(
      MCX_COMPLETION_MANIFEST,
      '{"version":1,"contributions":[{"name":"stale"}]}',
    )
    const older = new Date(Date.now() - 10000)
    fs.utimesSync(manifestPath(root), older, older)
    writeFile('mbler.config.js', CONFIG_WITHOUT_PLUGIN)
    const synced = await syncProjectCompletions(root)
    expect(synced.source).toBe('config')
    expect(synced.contributions).toEqual([])
    expect(fs.existsSync(manifestPath(root))).toBe(false)
  })
})

describe('collectWorkspaceContributions', () => {
  it('syncs every project under the workspace folder separately', async () => {
    writeFile(path.join('addons', 'shop', 'mbler.config.js'), CONFIG_WITH_PLUGIN)
    writeFile(path.join('addons', 'hud', 'mbler.config.js'), CONFIG_OTHER_PLUGIN)
    const synced = await collectWorkspaceContributions(root)
    expect(synced).toHaveLength(2)
    const names = synced.flatMap(item => item.contributions.map(entry => entry.name))
    expect(names.sort()).toEqual(['demo-plugin', 'inline', 'other'])
    expect(fs.existsSync(manifestPath(path.join(root, 'addons', 'shop')))).toBe(true)
    expect(fs.existsSync(manifestPath(path.join(root, 'addons', 'hud')))).toBe(true)
    expect(fs.existsSync(manifestPath(root))).toBe(false)
  })

  it('reads the root manifest when no config exists', async () => {
    writeFile(
      MCX_COMPLETION_MANIFEST,
      '{"version":1,"contributions":[{"name":"from-build"}]}',
    )
    const synced = await collectWorkspaceContributions(root)
    expect(synced).toHaveLength(1)
    expect(synced[0]?.source).toBe('manifest')
    expect(synced[0]?.contributions.map(item => item.name)).toEqual(['from-build'])
  })

  it('returns nothing for a workspace without config or manifest', async () => {
    expect(await collectWorkspaceContributions(root)).toEqual([])
  })
})
