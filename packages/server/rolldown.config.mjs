// @ts-check
import { defineConfig } from "rolldown"
import { dts } from "rolldown-plugin-dts"
import { rm } from "node:fs/promises"
const external = [
  /^node:/,
  'typescript',
]

const bundleExternal = [
  /^node:/,
]

const sharedPlugins = [
  dts()
]

function manualChunks(id) {
  if (id.includes('node_modules')) {
    if (id.includes('typescript') || id.includes('@babel')) return 'typescript-babel'
    if (id.includes('@volar')) return 'volar'
    if (id.includes('@vue')) return 'vue'
    if (id.includes('@mbler')) return 'mbler'
    if (id.includes('vscode-languageserver') || id.includes('vscode-uri')) return 'lsp'
    if (id.includes('volar-service-typescript')) return 'volar'
    if (id.includes('typescript-auto-import-cache')) return 'volar'
    if (id.includes('magic-string')) return 'vendor'
    if (id.includes('semver')) return 'vendor'
    return 'vendor'
  }
}

export default defineConfig([
  {
    input: './src/index.ts',
    output: {
      dir: './dist',
      format: 'esm',
      entryFileNames: '[name].js',
      sourcemap: true,
    },
    external,
    plugins: [
      {
        name: "rm-old-dist",
        async buildStart() {
          await rm('./dist', { recursive: true, force: true })
        }
      },
      ...sharedPlugins
    ],
  },
  {
    input: './src/server.ts',
    output: {
      dir: './dist',
      format: 'esm',
      sourcemap: true,
      manualChunks,
    },
    platform: 'node',
    external: bundleExternal,
    plugins: [
      {
        name: "shim-cjs-globals",
        renderChunk(code, chunk) {
          if (!chunk.name.includes('mbler')) return
          code = code.replace(
            /__require\("@babel\/parser"\)/g,
            'require_lib$5()',
          )
          const shims = `import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
          var __dirname = dirname(fileURLToPath(import.meta.url));
var __filename = __dirname + '/lib/typescript.js';
`
          const lines = code.split('\n')
          let lastImport = -1
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('import ')) lastImport = i
          }
          if (lastImport === -1) return
          lines.splice(lastImport + 1, 0, shims)
          return lines.join('\n')
        }
      }
    ],
  },
])
