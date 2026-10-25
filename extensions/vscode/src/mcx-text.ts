import { Position, Range, type TextDocument } from 'vscode'
import { CONTAINER_TAGS } from './mcx-tags.js'

/**
 * Token the cursor sits in, `@` / `:` / `-` included. `language-configuration.json`
 * declares no `wordPattern`, so VS Code treats those as word separators and
 * would replace only the part after them — accepting `@after` then yields
 * `@@after`. Replacing the whole token avoids that.
 */
export function getPartialToken(linePrefix: string): string {
  return /[\w@:-]*$/.exec(linePrefix)?.[0] ?? ''
}

export function getPartialTokenRange(
  linePrefix: string,
  position: Position,
): Range {
  const token = getPartialToken(linePrefix)
  return new Range(
    new Position(position.line, linePrefix.length - token.length),
    position,
  )
}

/** Keep the list a superset of what VS Code's own fuzzy filter accepts. */
export function matchesTypedToken(candidate: string, typed: string): boolean {
  if (!typed) return true
  const value = typed.toLowerCase()
  const target = candidate.toLowerCase()
  // `@` / `:` are part of the attribute name, not a separate token
  if (value.startsWith('@') || value.startsWith(':')) {
    return target.startsWith(value)
  }
  return target.includes(value)
}

export function isInsideOpenTag(linePrefix: string): boolean {
  const lt = linePrefix.lastIndexOf('<')
  const gt = linePrefix.lastIndexOf('>')
  return lt > gt
}

export function currentTagName(linePrefix: string): string | undefined {
  const match = linePrefix.match(/<([A-Za-z][\w:-]*)[^>]*$/)
  return match?.[1]
}

export function isCompletingScriptLang(linePrefix: string): boolean {
  const tag = currentTagName(linePrefix)
  if (tag !== 'script') {
    return false
  }
  return /\blang\s*=\s*(?:"[^"]*|'[^']*|[^\s>]*)?$/.test(linePrefix)
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface OpenTagEntry {
  name: string
  line: number
}

export function getOpenTagEntries(
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

export function getOpenTagStack(source: string): string[] {
  const stack: string[] = []
  const tagRegex = /<\/?([A-Za-z][\w:-]*)[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(source)) !== null) {
    if (match[0].startsWith('</')) {
      if (stack.length > 0 && stack[stack.length - 1] === match[1]) {
        stack.pop()
      }
    } else if (!match[0].endsWith('/>')) {
      stack.push(match[1]!)
    }
  }
  return stack
}

/**
 * Nearest enclosing tag that can contain other tags.
 *
 * While typing top-down the previous sibling is usually still unclosed
 * (`<title>text` without `</title>` yet), so the innermost open tag is often a
 * leaf the cursor has already moved past — skipping leaves is what keeps
 * `<Ui><title>text <button ` completing `button` children instead of nothing.
 */
export function getParentTagContext(
  document: TextDocument,
  position: Position,
): string | undefined {
  const entries = getOpenTagEntries(document, document.offsetAt(position))
  for (let i = entries.length - 1; i >= 0; i--) {
    const name = entries[i]!.name
    if (CONTAINER_TAGS.has(name)) return name
  }
  return undefined
}
