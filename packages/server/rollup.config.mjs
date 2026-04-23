import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import tsPlugin from '@rollup/plugin-typescript'

const sharedPlugins = [
  commonjs(),
  resolve({ preferBuiltins: true }),
  tsPlugin({ tsconfig: './tsconfig.json' }),
]
function createRegex(...a) {
  return a.map(i => new RegExp(i + '.+'))
}
const external = [
  /^node:/,
  createRegex(
    'typescript',
    '@volar/language-core',
    '@volar/language-server',
    'vscode-languageserver',
    'vscode-languageserver/node.js',
    'vscode-uri',
    '@volar/language-server/lib/server.js',
    '@mbler/mcx-core',
    'vscode-languageserver',
    'typescript',
    '@volar/language-service'
  ),
  'typescript',
  '@volar/language-core',
  '@volar/language-server',
  'vscode-languageserver',
  'vscode-languageserver/node.js',
  'vscode-uri',
  '@volar/language-server/lib/server.js',
  '@mbler/mcx-core',
  'vscode-languageserver',
  'typescript',
  '@volar/language-service',
  'fs',
  '@volar/language-server/lib/fileSystemProviders/http.js',
  '@volar/language-server/lib/fileSystemProviders/node.js',
  '@volar/language-server/lib/project/typescriptProject.js'
]

export default [
  {
    input: './src/index.ts',
    output: [
      {
        file: './dist/index.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: './dist/index.cjs',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
    ],
    external,
    plugins: sharedPlugins,
  },
  {
    input: './src/server.ts',
    output: {
      file: './dist/server.js',
      format: 'esm',
      sourcemap: true,
    },
    external,
    plugins: sharedPlugins,
  },
]
