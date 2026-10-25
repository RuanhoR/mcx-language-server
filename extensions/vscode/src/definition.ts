import {
  CancellationToken,
  Definition,
  Location,
  Position,
  Range,
  type TextDocument,
} from 'vscode'
import {
  computeLineOffsets,
  getCachedAST,
  getScriptBlock,
  getTagContentRangeRaw,
} from './mcx-ast.js'
import { escapeRegex } from './mcx-text.js'

/**
 * Go-to-definition for `<Event>` handler references: the handler side of a
 * `eventName = handler` line jumps to the exported function in the script.
 */
export async function provideMCXDefinition(
  document: TextDocument,
  position: Position,
  _token: CancellationToken,
): Promise<Definition | undefined> {
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

  const valueStr = valueMatch[1]!
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
