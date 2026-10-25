import type * as mcx from '@mbler/mcx-core'

// Lazy-load @mbler/mcx-core on first provider call.  A static import would
// drag `typescript` (a mcx-core dependency) into the eager vendor chunk,
// breaking extension activation in installed environments where TS resolves
// through our stub.
let mcxModulePromise: Promise<typeof mcx> | undefined
export function loadMcx(): Promise<typeof mcx> {
  return (mcxModulePromise ??= import('@mbler/mcx-core'))
}

export interface MCXTagContentNode {
  type: 'TagContent'
  data: string
}

export interface MCXCommentNode {
  type: 'Comment'
  data: string
}

export interface MCXTagNode {
  type: 'TagNode'
  name: string
  arr: Record<string, string | boolean>
  content: Array<MCXTagNode | MCXTagContentNode | MCXCommentNode>
  end:
    | {
        data?: string
        start?: MCXPosition
      }
    | null
  start: {
    data?: string
    start?: MCXPosition
  }
}

type MCXPosition = mcx.PubType.MCXPosition
export type { MCXPosition }

const astCache = new Map<
  string,
  { tags: MCXTagNode[]; compileData: any; timestamp: number }
>()
const AST_CACHE_TTL = 500

export async function getCachedAST(source: string): Promise<{
  tags: MCXTagNode[]
  compileData: any
}> {
  const cached = astCache.get(source)
  const now = Date.now()
  if (cached && now - cached.timestamp < AST_CACHE_TTL) {
    return cached
  }
  let tags: MCXTagNode[] = []
  let compileData: any = undefined
  try {
    const core = await loadMcx()
    tags = new (core as any).AST.tag(source).parseAST() as MCXTagNode[]
  } catch {}
  try {
    const core = await loadMcx()
    compileData = (core as any).compiler.compileMCXFn(source)
  } catch {}
  const result = { tags, compileData }
  astCache.set(source, { ...result, timestamp: now })
  if (astCache.size > 50) {
    const oldest = [...astCache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    )[0]
    if (oldest) astCache.delete(oldest[0])
  }
  return result
}

export async function parseTagNodes(source: string): Promise<MCXTagNode[]> {
  try {
    const core = await loadMcx()
    return new (core as any).AST.tag(source).parseAST() as MCXTagNode[]
  } catch {
    return []
  }
}

export function computeLineOffsets(text: string): number[] {
  const offsets = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1)
    }
  }
  return offsets
}

export function offsetAt(
  lineOffsets: number[],
  position: MCXPosition,
): number {
  const lineIndex = Math.max(
    0,
    Math.min(lineOffsets.length - 1, position.line - 1),
  )
  return lineOffsets[lineIndex]! + Math.max(0, position.column)
}

/** Absolute source range of a tag's content (between open and close tag). */
export function getTagContentRangeRaw(
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

/** Absolute source range of the `<script>` block's content, if any. */
export async function getScriptBlock(
  source: string,
): Promise<{ start: number; end: number } | undefined> {
  const parsed = await parseTagNodes(source)
  const scriptTag = parsed.find(node => node.name === 'script')
  if (!scriptTag) {
    return undefined
  }

  const lineOffsets = computeLineOffsets(source)
  const start =
    offsetAt(lineOffsets, scriptTag.start.start!) +
    (scriptTag.start.data?.length ?? 0)
  const end = scriptTag.end?.start
    ? offsetAt(lineOffsets, scriptTag.end.start)
    : start

  return { start, end }
}
