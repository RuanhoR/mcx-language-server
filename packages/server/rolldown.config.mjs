// @ts-check
import { defineConfig } from "rolldown"
import { dts } from "rolldown-plugin-dts"
function createRegex(...a) {
  return a.map(i => new RegExp(i + '.+'))
}
const external = [
  /^node:/,
  ...createRegex(
    'typescript',
    '@volar/language-core',
    '@volar/language-server',
    'vscode-languageserver',
    'vscode-uri',
    '@mbler/mcx-core',
    '@volar/language-service',
    'typescript-auto-import-cache'
  ),
  "@mbler/mcx-core",
  'fs',
  'semver',
  '@volar/language-server/lib/fileSystemProviders/http.js',
  '@volar/language-server/lib/fileSystemProviders/node.js',
  '@volar/language-server/lib/project/typescriptProject.js'
]
const sharedPlugins = [
  dts()
]
const pathMapping = {
  '@mbler/mcx-core': '@mbler/mcx-core',
}

export default defineConfig([
  {
    input: './src/index.ts',
    output: {
      dir: './dist',
      format: 'esm',
      sourcemap: true,
      paths: pathMapping,
    },
    external,
    plugins: sharedPlugins,
  },
  {
    input: './src/index.ts',
    output: {
      dir: './dist',
      entryFileNames: '[name].cjs',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
      paths: pathMapping,
    },
    external,
  },
  {
    input: './src/server.ts',
    output: {
      dir: './dist',
      format: 'esm',
      sourcemap: true,
    },
    external,
    plugins: sharedPlugins,
  },
])
