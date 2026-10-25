import {
  Hover,
  MarkdownString,
  Position,
  Range,
  type TextDocument,
} from 'vscode'
import { getScriptBlock } from './mcx-ast.js'
import { isInsideOpenTag } from './mcx-text.js'
import { ATTR_INFO, TAG_INFO, describeTagAttributes } from './mcx-tags.js'

export async function provideMCXHover(
  document: TextDocument,
  position: Position,
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

    const tagInfo = TAG_INFO[hoverInfo.tagName]
    if (tagInfo) {
      markdown.appendMarkdown(tagInfo)
      const attributes = describeTagAttributes(hoverInfo.tagName)
      if (attributes) {
        markdown.appendMarkdown(`\n\n**Attributes:** ${attributes}`)
      }
    } else {
      markdown.appendMarkdown('MCX custom tag\n\nThis tag does not have built-in documentation.')
    }
  }

  if (hoverInfo.type === 'attribute' && hoverInfo.attrName) {
    markdown.appendCodeblock(hoverInfo.attrName, 'xml')
    markdown.appendMarkdown('\n\n**MCX Attribute**\n\n')

    const attrInfo = ATTR_INFO[hoverInfo.attrName]
    if (attrInfo) {
      markdown.appendMarkdown(attrInfo.doc ?? attrInfo.summary)
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
  linePrefix: string,
): Promise<HoverInfo | undefined> {
  const script = await getScriptBlock(document.getText())
  if (script && isInsideRange(document, position, script)) {
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

function isInsideRange(
  document: TextDocument,
  position: Position,
  range: { start: number; end: number },
): boolean {
  const offset = document.offsetAt(position)
  return offset >= range.start && offset <= range.end
}

function getWordRangeAtPosition(
  document: TextDocument,
  position: Position,
): Range | undefined {
  const line = document.lineAt(position.line)
  const lineText = line.text

  let start = position.character
  let end = position.character

  while (start > 0 && /[\w@:-]/.test(lineText[start - 1]!)) {
    start--
  }

  while (end < lineText.length && /[\w@:-]/.test(lineText[end]!)) {
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
