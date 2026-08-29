import * as mcx from '@mbler/mcx-core'
import type {
  CodeMapping,
  IScriptSnapshot,
  VirtualCode,
} from '@volar/language-core'

type MCXPosition = mcx.PubType.MCXPosition
type MCXTagNode = mcx.PubType.ParsedTagNode

interface TagContentRange {
  start: number
  end: number
}

const FULL_FEATURES: NonNullable<CodeMapping['data']> = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
}

const DISABLED_FEATURES: NonNullable<CodeMapping['data']> = {
  verification: false,
  completion: false,
  semantic: false,
  navigation: false,
  structure: false,
  format: false,
}

type MCXRuntimeType = 'app' | 'event' | 'ui' | 'component'

class StringSnapshot implements IScriptSnapshot {
  constructor(private readonly text: string) {}

  public getText(start: number, end: number): string {
    return this.text.slice(start, end)
  }

  public getLength(): number {
    return this.text.length
  }

  public getChangeRange(_oldSnapshot: IScriptSnapshot): undefined {
    return void 0
  }
}

class EmbeddedCode implements VirtualCode {
  public readonly embeddedCodes: VirtualCode[] = []
  public readonly snapshot: IScriptSnapshot

  constructor(
    public readonly id: string,
    public readonly languageId: string,
    content: string,
    public readonly mappings: CodeMapping[],
  ) {
    this.snapshot = new StringSnapshot(content)
  }
}

/**
 * Root virtual code for an `.mcx` source file.
 *
 * We expose one TypeScript / JavaScript service script for language features,
 * and expose raw embedded ranges for Event/Component/UI so mappings remain complete.
 */
export class MCXVirtualCode implements VirtualCode {
  public readonly languageId = 'mcx' as const
  public readonly id = 'root' as const
  public snapshot: IScriptSnapshot
  public mappings: CodeMapping[] = []
  public embeddedCodes: VirtualCode[] = []

  constructor(snapshot: IScriptSnapshot) {
    this.snapshot = snapshot
    this.rebuild()
  }

  public update(newSnapshot: IScriptSnapshot): void {
    this.snapshot = newSnapshot
    this.rebuild()
  }

  private rebuild(): void {
    const source = this.snapshot.getText(0, this.snapshot.getLength())
    const lineOffsets = this.computeLineOffsets(source)
    const tags = this.parseTagNodes(source)

    this.mappings = [
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [this.snapshot.getLength()],
        data: DISABLED_FEATURES,
      },
    ]
    this.embeddedCodes = []

    const scriptTag = tags.find(tag => tag.name === 'script')
    if (scriptTag) {
      const scriptCode = this.createServiceScriptEmbedded(
        source,
        scriptTag,
        lineOffsets,
        tags,
      )
      if (scriptCode) {
        this.embeddedCodes.push(scriptCode)
      }
    }

    const eventTag = tags.find(tag => tag.name === 'Event')
    if (eventTag) {
      const eventRaw = this.createRawEmbedded(
        'event-raw',
        'mcx',
        source,
        eventTag,
        lineOffsets,
      )
      if (eventRaw) {
        this.embeddedCodes.push(eventRaw)
      }
    }

    const componentTag = tags.find(tag => tag.name === 'Component')
    if (componentTag) {
      const componentRaw = this.createRawEmbedded(
        'component-raw',
        'mcx',
        source,
        componentTag,
        lineOffsets,
      )
      if (componentRaw) {
        this.embeddedCodes.push(componentRaw)
      }
    }

    const uiTag = tags.find(tag => tag.name === 'Ui')
    if (uiTag) {
      const uiRaw = this.createRawEmbedded(
        'ui-raw',
        'mcx',
        source,
        uiTag,
        lineOffsets,
      )
      if (uiRaw) {
        this.embeddedCodes.push(uiRaw)
      }
    }

    const formTag = tags.find(tag => tag.name === 'Form')
    if (formTag) {
      const formRaw = this.createRawEmbedded(
        'form-raw',
        'mcx',
        source,
        formTag,
        lineOffsets,
      )
      if (formRaw) {
        this.embeddedCodes.push(formRaw)
      }
    }
  }

  private parseTagNodes(source: string): MCXTagNode[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser = new (mcx as any).AST.tag(source)
      return parser.parseAST() as MCXTagNode[]
    } catch {
      return []
    }
  }

  private createServiceScriptEmbedded(
    source: string,
    scriptTag: MCXTagNode,
    lineOffsets: number[],
    tags: MCXTagNode[],
  ): EmbeddedCode | null {
    const range = this.getTagContentRange(source, scriptTag, lineOffsets)
    if (!range) {
      return null
    }

    const scriptSource = source.slice(range.start, range.end)
    // Skip the newline right after the opening tag so generated offset 0 is
    // real script text: auto-import edits inserted at the top of the virtual
    // file then map to the first script line instead of the `<script>` line.
    const leadingWsMatch = scriptSource.match(/^[ \t]*\r?\n/)
    const scriptContentOffset = range.start + (leadingWsMatch?.[0].length ?? 0)
    const scriptContent = leadingWsMatch
      ? scriptSource.slice(leadingWsMatch[0].length)
      : scriptSource
    const scriptLang = (scriptTag.arr?.lang ?? '').toString().toLowerCase()
    const isTypeScript = scriptLang === 'ts' || scriptLang === 'typescript'

    type MCXCompileData = InstanceType<typeof mcx.compiler.MCXCompileData>
    let compileData: MCXCompileData | undefined
    try {
      compileData = mcx.compiler.compileMCXFn(source)
    } catch {
      compileData = undefined
    }

    const metadataSection = this.buildMetadataSection(tags)
    const validationSection = compileData
      ? this.buildEventValidationSection(compileData)
      : ''
    const runtimeSection = this.buildRuntimeModelSection(
      source,
      isTypeScript,
      compileData,
    )
    const { scriptText, mappings } = this.buildScriptContent(
      scriptContent,
      scriptContentOffset,
      isTypeScript,
      compileData,
    )
    const generated =
      scriptText + metadataSection + validationSection + runtimeSection

    return new EmbeddedCode(
      'script',
      isTypeScript ? 'typescript' : 'javascript',
      generated,
      mappings,
    )
  }

  private createRawEmbedded(
    id: string,
    languageId: string,
    source: string,
    tag: MCXTagNode,
    lineOffsets: number[],
  ): EmbeddedCode | null {
    const range = this.getTagContentRange(source, tag, lineOffsets)
    if (!range) {
      return null
    }

    const content = source.slice(range.start, range.end)

    return new EmbeddedCode(id, languageId, content, [
      {
        sourceOffsets: [range.start],
        generatedOffsets: [0],
        lengths: [content.length],
        data: DISABLED_FEATURES,
      },
    ])
  }

  /**
   * Build the embedded script text for the TypeScript service.
   *
   * In an app file the build shadows every default/namespace import of an
   * `.mcx` event file with `declare const <name>: Event` so calls like
   * `event.subscribe()` type-check (the imported binding would otherwise keep
   * the generic `MCXFile<"event">` type of the imported module).
   *
   * The import statement itself stays in the generated code but with a
   * renamed internal binding: the module path must remain a real import so
   * hovering the source statement still shows the `import ...` /
   * `module "..."` documentation and go-to-definition opens the event file.
   * Only the internal binding name lies outside the mappings.
   */
  private buildScriptContent(
    scriptContent: string,
    scriptContentOffset: number,
    isTypeScript: boolean,
    compileData?: InstanceType<typeof mcx.compiler.MCXCompileData>,
  ): { scriptText: string; mappings: CodeMapping[] } {
    const defaultMappings: CodeMapping[] = []
    if (scriptContent.length > 0) {
      defaultMappings.push({
        sourceOffsets: [scriptContentOffset],
        generatedOffsets: [0],
        lengths: [scriptContent.length],
        data: FULL_FEATURES,
      })
    }

    if (
      !compileData ||
      !isTypeScript ||
      this.resolveRuntimeType(compileData) !== 'app'
    ) {
      return { scriptText: scriptContent, mappings: defaultMappings }
    }

    const eventImports = this.extractEventImports(compileData)
    if (eventImports.length === 0) {
      return { scriptText: scriptContent, mappings: defaultMappings }
    }

    const injectedTypes = new Map(
      eventImports.map(imp => [
        imp.as,
        imp.type === 'all'
          ? `{ default: import("@mbler/mcx-types").Event }`
          : `import("@mbler/mcx-types").Event`,
      ]),
    )

    const importRe =
      /\bimport\s+(?:([\w$]+)\s*from|\*\s*as\s+([\w$]+)\s*from)\s*(["'])([^"']+\.mcx)\3;?/g

    let scriptText = ''
    const mappings: CodeMapping[] = []
    let srcPos = 0
    let genPos = 0
    let shadowed = 0

    const pushMappedSegment = (length: number): void => {
      if (length <= 0) return
      mappings.push({
        sourceOffsets: [scriptContentOffset + srcPos],
        generatedOffsets: [genPos],
        lengths: [length],
        data: FULL_FEATURES,
      })
      scriptText += scriptContent.slice(srcPos, srcPos + length)
      srcPos += length
      genPos += length
    }

    const pushUnmapped = (text: string): void => {
      scriptText += text
      genPos += text.length
    }

    for (const match of scriptContent.matchAll(importRe)) {
      const bindingName = match[1] ?? match[2]
      const replacement = injectedTypes.get(bindingName)
      if (!replacement) continue

      const stmt = match[0]
      const start = match.index
      // The binding is the last token before ` from `; match its prefix
      // (`import ` / `import * as `) so the generated import keeps the exact
      // same leading text and stays mapped 1:1.
      const bindMatch = /^(?:import\s+)(?:\*\s*as\s+)?([\w$]+)/.exec(stmt)
      const bindRel = bindMatch ? bindMatch[0].length - bindMatch[1]!.length : 7

      // 1) prefix — identical text in source and generated import
      pushMappedSegment(start + bindRel - srcPos)
      // 2) renamed internal binding — keeps the module import alive for
      //    hover/navigation but must not surface its name; skip the source
      //    binding without mapping it
      pushUnmapped(`__mcx_import_${shadowed}`)
      srcPos = start + bindRel + bindingName.length
      // 3) ` from "<path>";` tail — identical text again
      pushMappedSegment(start + stmt.length - srcPos)
      // 4) shadowing declaration (unmapped, like the generated sections);
      //    only its binding name token maps back to the source binding
      const declBindingGen = genPos + 1 + 'declare const '.length
      pushUnmapped(`\ndeclare const ${bindingName}: ${replacement};`)
      mappings.push({
        sourceOffsets: [scriptContentOffset + start + bindRel],
        generatedOffsets: [declBindingGen],
        lengths: [bindingName.length],
        data: FULL_FEATURES,
      })
      shadowed++
    }

    if (shadowed === 0) {
      return { scriptText: scriptContent, mappings: defaultMappings }
    }

    pushMappedSegment(scriptContent.length - srcPos)
    return { scriptText, mappings }
  }

  private buildRuntimeModelSection(
    source: string,
    isTypeScript: boolean,
    compileData?: InstanceType<typeof mcx.compiler.MCXCompileData>,
  ): string {
    try {
      const data = compileData ?? mcx.compiler.compileMCXFn(source)
      const runtimeType = this.resolveRuntimeType(data)
      const hasScriptDefaultExport = this.hasScriptDefaultExport(
        data?.JSIR?.BuildCache?.export ?? [],
      )
      const lines: string[] = [
        '',
        '/* MCX runtime compatibility for TypeScript service */',
      ]

      let appData = '{}'
      let eventImports: ReturnType<typeof this.extractEventImports> = []
      if (runtimeType === 'app') {
        eventImports = this.extractEventImports(data)
        if (eventImports.length >= 1) {
          lines.push(...this.buildEventImportsSection(eventImports))
          appData = '__MCX_app_data'
        }
      }

      if (isTypeScript) {
        const runtimeExportType = this.getTypeScriptRuntimeExportType(
          runtimeType,
          eventImports.length >= 1,
        )
        lines.push(
          `type __MCX_runtime_type = ${JSON.stringify(runtimeType)};`,
          `type __MCX_runtime_export = ${runtimeExportType};`,
        )

        const runtimeApp =
          runtimeType === 'app' && eventImports.length >= 1
            ? 'typeof __MCX_app_data'
            : '{}'
        lines.push(
          `const __MCX_runtime_default_export = null as unknown as __MCX_runtime_export & { app: ${runtimeApp} };`,
        )

        if (!hasScriptDefaultExport) {
          lines.push('export default __MCX_runtime_default_export;')
        }
        return `${lines.join('\n')}\n`
      }

      lines.push(
        `const __MCX_runtime_default_export = { type: ${JSON.stringify(runtimeType)}, setup: ${runtimeType === 'component' ? 'null' : 'undefined'}, app: ${appData} };`,
      )
      if (!hasScriptDefaultExport) {
        lines.push('export default __MCX_runtime_default_export;')
      }
      return `${lines.join('\n')}\n`
    } catch {
      return ''
    }
  }

  private extractEventImports(
    compileData: InstanceType<typeof mcx.compiler.MCXCompileData>,
  ): Array<{ type: 'default' | 'all'; as: string; source: string }> {
    const imports: Array<{
      type: 'default' | 'all'
      as: string
      source: string
    }> = []
    const importList = compileData?.JSIR?.BuildCache?.import
    if (!importList || !Array.isArray(importList)) {
      return imports
    }

    for (const imp of importList) {
      const source = imp.source
      if (!source) continue
      const sourcePath = source.toString()

      if (!sourcePath.endsWith('.mcx')) continue

      for (const impItem of imp.imported || []) {
        const isAll = impItem.isAll
        const impName = impItem.import
        if (impName === 'default' || isAll) {
          imports.push({
            type: isAll ? 'all' : 'default',
            as: impItem.as,
            source: sourcePath,
          })
        }
      }
    }
    return imports
  }

  private buildEventImportsSection(
    eventImports: Array<{
      type: 'default' | 'all'
      as: string
      source: string
    }>,
  ): string[] {
    const lines: string[] = []
    lines.push('\n/* MCX event imports for app setup context */')

    lines.push(`type __MCX_event_imports = {`)
    for (const imp of eventImports) {
      if (imp.type === 'all') {
        lines.push(
          `  ${imp.as}: { default: import("@mbler/mcx-types").Event },`,
        )
      } else {
        lines.push(`  ${imp.as}: import("@mbler/mcx-types").Event ,`)
      }
    }
    lines.push(`};`)

    lines.push('declare const __MCX_ctx: import("@mbler/mcx-types").MCXCtx;')

    if (eventImports.length >= 1) {
      lines.push('\n/* MCX event runtime transforms */')
      const varDeclarations: string[] = []
      const eventValues: string[] = []

      eventImports.forEach((imp, index) => {
        const internalName = `__mcx_event_${index}`
        if (imp.type === 'all') {
          varDeclarations.push(
            `const ${internalName} = { default: __MCX_ctx.event[${index}] };`,
          )
          eventValues.push(`${internalName}.default`)
        } else {
          varDeclarations.push(
            `const ${internalName} = __MCX_ctx.event[${index}];`,
          )
          eventValues.push(internalName)
        }
      })

      lines.push(...varDeclarations)
      lines.push(
        `const __MCX_app_data = { event: [${eventValues.join(', ')}] };`,
      )
    }

    return lines
  }

  private buildEventValidationSection(
    compileData: InstanceType<typeof mcx.compiler.MCXCompileData>,
  ): string {
    const eventData = compileData?.strLoc?.Event
    if (!eventData?.isLoad) return ''

    const on = eventData.on
    const subscribe = eventData.subscribe
    const worldEventsProp = on === 'before' ? 'beforeEvents' : 'afterEvents'

    const chunks: string[] = []
    chunks.push('\n/* MCX event key validation */')
    chunks.push('declare const __mcx_world: import("@minecraft/server").World;')

    let extendsIndex = 0
    for (const [key, value] of Object.entries(subscribe ?? {})) {
      if (key === 'McxExtendsBy') {
        for (const extFile of value.split(',').map(s => s.trim())) {
          if (!extFile) continue
          // Type-level reference instead of a real `import` statement: an
          // injected import in the generated (unmapped) tail would make the
          // auto-import fixer place user imports after it, where the edit
          // can't be mapped back to the .mcx source and gets dropped.
          chunks.push(
            `declare const __mcx_ext_${extendsIndex}: import(${JSON.stringify(extFile)}).default;`,
          )
          chunks.push(`void __mcx_ext_${extendsIndex};`)
          extendsIndex++
        }
        continue
      }

      const eventName = this.extractWorldEventName(key)
      if (!eventName) continue
      chunks.push(`void __mcx_world.${worldEventsProp}.${eventName};`)
    }

    if (chunks.length <= 2) return ''

    return `\n${chunks.join('\n')}\n`
  }

  private extractWorldEventName(key: string): string | null {
    if (/^(?:[$_a-zA-Z][$_a-zA-Z0-9]*)$/.test(key)) {
      return key
    }
    return null
  }

  private resolveRuntimeType(
    compileData: InstanceType<typeof mcx.compiler.MCXCompileData>,
  ): MCXRuntimeType {
    let type: MCXRuntimeType = 'app'

    if (compileData?.strLoc?.Event?.isLoad) {
      type = 'event'
    }
    if (compileData?.strLoc?.UI || (compileData?.strLoc as { Form?: unknown } | undefined)?.Form) {
      type = 'ui'
    }
    if (Object.keys(compileData?.strLoc?.Component ?? {}).length >= 1) {
      type = 'component'
    }

    return type
  }

  private getTypeScriptRuntimeExportType(
    runtimeType: MCXRuntimeType,
    hasEventImports: boolean = false,
  ): string {
    const mcxTypes = 'import("@mbler/mcx-types")'
    if (runtimeType === 'app') {
      if (hasEventImports) {
        return `Omit<${mcxTypes}.MCXFile<"app">, "app">`
      }
      return `${mcxTypes}.MCXFile<"app">`
    }
    if (runtimeType === 'event') {
      // In app context the buildEventImportsSection overrides this to Event;
      // standalone event files keep the generic MCXFile wrapper.
      return `${mcxTypes}.MCXFile<"event">`
    }
    if (runtimeType === 'ui') {
      return `${mcxTypes}.MCXFile<"ui">`
    }
    // component: named exports pass through from script source,
    // default export is a lightweight marker (like Vue SFC).
    return `{ type: 'component' }`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hasScriptDefaultExport(exportNodes: any[]): boolean {
    for (const item of exportNodes) {
      if (!item || typeof item !== 'object') {
        continue
      }

      if (item.type === 'ExportDefaultDeclaration') {
        return true
      }

      if (
        item.type === 'ExportNamedDeclaration' &&
        Array.isArray(item.specifiers)
      ) {
        for (const specifier of item.specifiers) {
          const exported = specifier?.exported
          const exportedName = this.getExportedName(exported)
          if (exportedName === 'default') {
            return true
          }
        }
      }
    }

    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getExportedName(node: any): string | undefined {
    if (!node || typeof node !== 'object') {
      return void 0
    }
    if (typeof node.name === 'string') {
      return node.name
    }
    if (typeof node.value === 'string') {
      return node.value
    }
    return void 0
  }

  private buildMetadataSection(tags: MCXTagNode[]): string {
    const chunks: string[] = []

    const eventTag = tags.find(tag => tag.name === 'Event')
    if (eventTag) {
      const raw = this.firstTextChild(eventTag)?.trim()
      if (raw) {
        chunks.push('\n/* MCX Event block */')
        chunks.push(`const __mcx_event_raw = ${JSON.stringify(raw)};`)
        chunks.push('void __mcx_event_raw;')
      }
    }

    const componentTag = tags.find(tag => tag.name === 'Component')
    if (componentTag) {
      const refs = this.collectComponentReferences(componentTag)
      if (refs.length > 0) {
        chunks.push('\n/* MCX Component export references */')
        for (const ref of refs) {
          chunks.push(`void (${ref});`)
        }
      }
    }

    const uiTag = tags.find(tag => tag.name === 'Ui')
    const formTag = tags.find(tag => tag.name === 'Form')
    const layoutTag = uiTag || formTag
    if (layoutTag) {
      const refs = this.collectLayoutReferences(layoutTag)
      if (refs.length > 0) {
        chunks.push('\n/* MCX UI/Form template variable references */')
        for (const ref of refs) {
          chunks.push(`void (${ref});`)
        }
      }
    }

    if (chunks.length === 0) {
      return ''
    }

    return `\n${chunks.join('\n')}\n`
  }

  private firstTextChild(tag: MCXTagNode): string | undefined {
    for (const child of tag.content) {
      if ((child as { type?: string }).type === 'TagContent') {
        return (child as { data: string }).data
      }
    }
    return void 0
  }

  private collectComponentReferences(componentTag: MCXTagNode): string[] {
    const refs: string[] = []

    for (const parent of componentTag.content) {
      if (!this.isTagNode(parent)) {
        continue
      }

      for (const item of parent.content) {
        if (!this.isTagNode(item)) {
          continue
        }

        const ref = this.firstTextChild(item)?.trim()
        if (!ref) {
          continue
        }

        // Keep reference lines syntax-safe to avoid polluting diagnostics.
        if (this.isSafeReferenceExpression(ref)) {
          refs.push(ref)
        }
      }
    }

    return refs
  }

  private collectLayoutReferences(layoutTag: MCXTagNode): string[] {
    const refs = new Set<string>()
    const reserved = new Set(['true', 'false', 'null', 'undefined', 'this', 'new', 'typeof', 'instanceof', 'void', 'NaN', 'Infinity'])

    const extractIds = (expr: string) => {
      const regex = /\b([a-zA-Z_$][\w$]*)\b/g
      let m: RegExpExecArray | null
      while ((m = regex.exec(expr)) !== null) {
        if (!reserved.has(m[1]!)) {
          refs.add(m[1]!)
        }
      }
    }

    for (const child of layoutTag.content) {
      if (!this.isTagNode(child)) continue

      // Extract from tag body content: {{ expr }}
      const textContent = this.firstTextChild(child)
      if (textContent) {
        const interpolationRegex = /\{\{\s*(.*?)\s*\}\}/g
        let match: RegExpExecArray | null
        while ((match = interpolationRegex.exec(textContent)) !== null) {
          extractIds(match[1]!)
        }
      }

      // Extract from dynamic attributes: :name="expr"
      if (child.arr && typeof child.arr === 'object') {
        for (const [key, value] of Object.entries(child.arr)) {
          if (key.startsWith(':') && typeof value === 'string') {
            extractIds(value)
          }
        }

        // Extract from 'for': "variable in|of propName"
        const forVal = child.arr.for
        if (typeof forVal === 'string') {
          const forMatch = forVal.match(/^(\w+)\s+(?:in|of)\s+(\w+)$/)
          if (forMatch) {
            extractIds(forMatch[2]!)
          }
        }

        // Extract from 'if'
        const ifVal = child.arr.if
        if (typeof ifVal === 'string') {
          extractIds(ifVal)
        }
      }
    }

    return [...refs]
  }

  private isSafeReferenceExpression(value: string): boolean {
    return /^[$_A-Za-z][$_A-Za-z0-9]*(?:\.[$_A-Za-z][$_A-Za-z0-9]*)*$/.test(
      value,
    )
  }

  private isTagNode(node: unknown): node is MCXTagNode {
    return (
      !!node &&
      typeof node === 'object' &&
      'name' in (node as object) &&
      'start' in (node as object)
    )
  }

  private getTagContentRange(
    source: string,
    tag: MCXTagNode,
    lineOffsets: number[],
  ): TagContentRange | null {
    if (!tag.start || !tag.start.start) {
      return null
    }

    const startOffset = this.offsetAt(lineOffsets, tag.start.start)
    const startTagEnd = Math.min(
      source.length,
      startOffset + (tag.start.data?.length ?? 0),
    )

    let endTagStart = startTagEnd
    if (tag.end?.start) {
      endTagStart = this.offsetAt(lineOffsets, tag.end.start)
    }

    if (endTagStart < startTagEnd) {
      endTagStart = startTagEnd
    }

    return {
      start: startTagEnd,
      end: Math.min(source.length, endTagStart),
    }
  }

  private computeLineOffsets(text: string): number[] {
    const offsets = [0]
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        offsets.push(i + 1)
      }
    }
    return offsets
  }

  private offsetAt(lineOffsets: number[], position: MCXPosition): number {
    const lineIndex = Math.max(
      0,
      Math.min(lineOffsets.length - 1, position.line - 1),
    )
    return lineOffsets[lineIndex] + Math.max(0, position.column)
  }
}
