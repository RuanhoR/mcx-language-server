import type {
  LanguagePlugin,
  VirtualCode,
  IScriptSnapshot,
  CodeMapping,
} from '@volar/language-core'
import type * as ts from 'typescript'
import { MCXVirtualCode } from './code.js'

interface TypeScriptServiceScript {
  code: VirtualCode
  scriptKind: ts.ScriptKind
  preventLeadingOffset: boolean
  extension: string
}

interface TypeScriptLanguageSupport {
  getServiceScript(
    virtualCode: VirtualCode,
  ): TypeScriptServiceScript | undefined
  extraFileExtensions: {
    extension: string
    isMixedContent: boolean
    scriptKind: ts.ScriptKind
  }[]
}

type ImageComponentType =
  | 'PNGImageComponent'
  | 'SVGImageComponent'
  | 'JPGImageComponent'
  | 'GIFImageComponent'

const IMAGE_EXTENSION_MAP: Record<string, ImageComponentType> = {
  '.png': 'PNGImageComponent',
  '.svg': 'SVGImageComponent',
  '.jpg': 'JPGImageComponent',
  '.jpeg': 'JPGImageComponent',
  '.gif': 'GIFImageComponent',
}

export interface MCXLanguagePlugin extends LanguagePlugin<unknown, VirtualCode> {
  typescript: TypeScriptLanguageSupport
}

function createImageVirtualCode(
  filePath: string,
  snapshot: IScriptSnapshot,
): VirtualCode {
  const imageType = IMAGE_EXTENSION_MAP[filePath.slice(filePath.lastIndexOf('.'))]
  const componentType = imageType ?? 'PNGImageComponent'
  const generatedCode =
    `import type * as mcx from '@mbler/mcx-core';\nexport default null as unknown as mcx.${componentType};\n`

  const disabledData: CodeMapping['data'] = {
    verification: false,
    completion: false,
    semantic: false,
    navigation: false,
    structure: false,
    format: false,
  }

  return {
    id: 'image-root',
    languageId: 'mcx-image',
    snapshot,
    mappings: [
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [snapshot.getLength()],
        data: disabledData,
      },
    ],
    embeddedCodes: [
      {
        id: 'script',
        languageId: 'typescript',
        snapshot: {
          getText(start: number, end: number): string {
            return generatedCode.slice(start, end)
          },
          getLength(): number {
            return generatedCode.length
          },
          getChangeRange(): undefined {
            return undefined
          },
        },
        mappings: [],
        embeddedCodes: [],
      },
    ],
  }
}

/**
 * Create the language plugin used by Volar to parse `.mcx` files
 * and provide type information for image imports (`.png`, `.jpg`, etc.).
 */
export function createMCXLanguagePlugin(
  tsModule: typeof import('typescript'),
): MCXLanguagePlugin {
  return {
    getLanguageId(scriptId: unknown): string | undefined {
      const id = thisId(scriptId)
      if (id.endsWith('.mcx')) {
        return 'mcx'
      }
      const ext = id.slice(id.lastIndexOf('.'))
      if (ext in IMAGE_EXTENSION_MAP) {
        return 'mcx-image'
      }
      return undefined
    },
    createVirtualCode(
      scriptId: unknown,
      languageId: string,
      snapshot: IScriptSnapshot,
    ): VirtualCode | undefined {
      if (languageId === 'mcx') {
        return new MCXVirtualCode(snapshot)
      }
      if (languageId === 'mcx-image') {
        return createImageVirtualCode(thisId(scriptId), snapshot)
      }
      return undefined
    },
    updateVirtualCode(
      scriptId: unknown,
      virtualCode: VirtualCode,
      newSnapshot: IScriptSnapshot,
    ): VirtualCode {
      if (virtualCode instanceof MCXVirtualCode) {
        virtualCode.update(newSnapshot)
        return virtualCode
      }
      return createImageVirtualCode(thisId(scriptId), newSnapshot)
    },
    typescript: {
      extraFileExtensions: [
        {
          extension: 'mcx',
          isMixedContent: true,
          scriptKind: tsModule.ScriptKind.Deferred,
        },
        { extension: 'png', isMixedContent: false, scriptKind: tsModule.ScriptKind.TS },
        { extension: 'svg', isMixedContent: false, scriptKind: tsModule.ScriptKind.TS },
        { extension: 'jpg', isMixedContent: false, scriptKind: tsModule.ScriptKind.TS },
        { extension: 'jpeg', isMixedContent: false, scriptKind: tsModule.ScriptKind.TS },
        { extension: 'gif', isMixedContent: false, scriptKind: tsModule.ScriptKind.TS },
      ],
      getServiceScript(
        virtualCode: VirtualCode,
      ): TypeScriptServiceScript | undefined {
        const scriptCode = virtualCode.embeddedCodes?.find(
          code => code.id === 'script',
        )
        if (!scriptCode) {
          return undefined
        }

        const isTypeScript = scriptCode.languageId === 'typescript'
        return {
          code: scriptCode,
          scriptKind: isTypeScript
            ? tsModule.ScriptKind.TS
            : tsModule.ScriptKind.JS,
          preventLeadingOffset: false,
          extension: isTypeScript ? '.ts' : '.js',
        }
      },
    },
  }
}

export function createMCXVirtualCode(
  snapshot: IScriptSnapshot,
): MCXVirtualCode {
  return new MCXVirtualCode(snapshot)
}

function thisId(scriptId: unknown): string {
  if (typeof scriptId === 'string') {
    return scriptId
  }

  if (scriptId && typeof scriptId === 'object') {
    const fileName = (scriptId as { fileName?: unknown }).fileName
    if (typeof fileName === 'string') {
      return fileName
    }

    const path = (scriptId as { path?: unknown }).path
    if (typeof path === 'string') {
      return path
    }

    const fsPath = (scriptId as { fsPath?: unknown }).fsPath
    if (typeof fsPath === 'string') {
      return fsPath
    }
  }

  return String(scriptId ?? '')
}
