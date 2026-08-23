import { createMCXLanguagePlugin } from '@mbler/mcx-server'
import { LanguagePlugin } from '@volar/language-core'
import { runTsc } from '@volar/typescript/lib/quickstart/runTsc.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function runTSC(
  tscpath: string = require.resolve('typescript/lib/tsc')
): void {
  runTsc(
    tscpath,
    {
      extraSupportedExtensions: [
        '.mcx',
        '.png',
        '.svg',
        '.jpg',
        '.jpeg',
        '.gif',
      ],
      extraExtensionsToRemove: [
        '.mcx',
        '.png',
        '.svg',
        '.jpg',
        '.jpeg',
        '.gif',
      ],
    },
    (ts): LanguagePlugin<string>[] => {
      return [createMCXLanguagePlugin(ts) as unknown as LanguagePlugin<string>]
    }
  )
}

export default runTSC
