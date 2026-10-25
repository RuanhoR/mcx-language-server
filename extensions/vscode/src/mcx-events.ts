/**
 * World event names for `<Event>` key completion, mirroring
 * `@mbler/mcx-core` eslint-plugin-mcx.
 *
 * The bundled lists are the FALLBACK (generated from
 * @minecraft/server@2.9.0-beta.1.26.30-preview.21, same source as
 * eslint-plugin-mcx/src/generated-events.ts). At completion time the lists are
 * normally extracted from the project's own @minecraft/server index.d.ts so
 * the offered names match the installed version.
 */

export const WORLD_AFTER_EVENTS: readonly string[] = [
  'blockContainerClosed',
  'blockContainerOpened',
  'blockExplode',
  'buttonPush',
  'chatSend',
  'dataDrivenEntityTrigger',
  'effectAdd',
  'entityContainerClosed',
  'entityContainerOpened',
  'entityDie',
  'entityHeal',
  'entityHealthChanged',
  'entityHitBlock',
  'entityHitEntity',
  'entityHurt',
  'entityItemDrop',
  'entityItemPickup',
  'entityLoad',
  'entityRemove',
  'entitySpawn',
  'entityUpgrade',
  'explosion',
  'gameRuleChange',
  'itemCompleteUse',
  'itemReleaseUse',
  'itemStartUse',
  'itemStartUseOn',
  'itemStopUse',
  'itemStopUseOn',
  'itemUse',
  'leverAction',
  'messageReceive',
  'packSettingChange',
  'pistonActivate',
  'playerBreakBlock',
  'playerButtonInput',
  'playerDimensionChange',
  'playerEmote',
  'playerGameModeChange',
  'playerHotbarSelectedSlotChange',
  'playerInputModeChange',
  'playerInputPermissionCategoryChange',
  'playerInteractWithBlock',
  'playerInteractWithEntity',
  'playerInventoryItemChange',
  'playerJoin',
  'playerLeave',
  'playerPlaceBlock',
  'playerSpawn',
  'playerSwingStart',
  'playerUseNameTag',
  'pressurePlatePop',
  'pressurePlatePush',
  'projectileHitBlock',
  'projectileHitEntity',
  'targetBlockHit',
  'tripWireTrip',
  'weatherChange',
  'worldLoad',
]

export const WORLD_BEFORE_EVENTS: readonly string[] = [
  'chatSend',
  'effectAdd',
  'entityHeal',
  'entityHurt',
  'entityItemPickup',
  'entityRemove',
  'explosion',
  'itemUse',
  'playerBreakBlock',
  'playerGameModeChange',
  'playerInteractWithBlock',
  'playerInteractWithEntity',
  'playerLeave',
  'playerPlaceBlock',
  'weatherChange',
]

/** Non-event keys the `<Event>` block also accepts. */
export const MCX_EVENT_DIRECTIVES: readonly string[] = ['McxExtendsBy']

export interface WorldEventLists {
  after: readonly string[]
  before: readonly string[]
  /** where the lists came from: the resolved d.ts path or 'bundled' */
  source: string
}

/** Extract `readonly <name>:` property names from one world event class. */
export function extractClassProps(text: string, className: string): string[] {
  const open = new RegExp(`export\\s+class\\s+${className}\\s*\\{`).exec(text)
  if (!open) throw new Error(`${className} not found in index.d.ts`)
  let depth = 1
  let i = open.index + open[0].length
  const bodyStart = i
  while (depth > 0 && i < text.length) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  if (depth !== 0) throw new Error(`unbalanced braces in ${className}`)
  const body = text.slice(bodyStart, i - 1)
  const names: string[] = []
  const propRe = /readonly\s+([A-Za-z_$][\w$]*)\s*:/g
  let m: RegExpExecArray | null
  while ((m = propRe.exec(body)) !== null) names.push(m[1] as string)
  return names.sort()
}

export const BUNDLED_LISTS: WorldEventLists = {
  after: WORLD_AFTER_EVENTS,
  before: WORLD_BEFORE_EVENTS,
  source: 'bundled',
}

const cacheByPath = new Map<string, WorldEventLists>()

/**
 * World event lists for the document's project: extracted from the
 * @minecraft/server installed under one of `projectRoots`, falling back to the
 * bundled lists. Cached per d.ts path; an unreadable project just falls back.
 */
export async function resolveWorldEventLists(
  readFile: (path: string) => Promise<string>,
  projectRoots: string[],
  join: (...parts: string[]) => string,
): Promise<WorldEventLists> {
  for (const root of projectRoots) {
    const candidates = [
      join(root, 'node_modules', '@minecraft', 'server', 'index.d.ts'),
      join(root, 'scripts', 'node_modules', '@minecraft', 'server', 'index.d.ts'),
    ]
    for (const dtsPath of candidates) {
      const cached = cacheByPath.get(dtsPath)
      if (cached) return cached
      try {
        const text = await readFile(dtsPath)
        const lists: WorldEventLists = {
          after: extractClassProps(text, 'WorldAfterEvents'),
          before: extractClassProps(text, 'WorldBeforeEvents'),
          source: dtsPath,
        }
        cacheByPath.set(dtsPath, lists)
        return lists
      } catch {
        // try the next candidate, then the next root
      }
    }
  }
  return BUNDLED_LISTS
}
