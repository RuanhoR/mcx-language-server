// @ts-check
import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'
import { rm } from 'node:fs/promises'
export default defineConfig([
  {
    input: {
      index: './src/index.ts',
      'completion/index': './src/completion/index.ts',
    },
    output: {
      dir: './dist',
      format: 'esm',
      entryFileNames: '[name].js',
      sourcemap: true,
    },
    external: (id, importer, isResolved) => !isResolved && !id.startsWith('.'),
    plugins: [
      {
        name: 'rm-old-dist',
        async buildStart() {
          await rm('./dist', { recursive: true, force: true })
        },
      },
      dts(),
    ],
  },
  {
    input: './src/server.ts',
    output: {
      dir: './dist',
      format: 'esm',
      sourcemap: true,
    },
    platform: 'node',
    external: (id, importer, isResolved) => !isResolved && !id.startsWith('.'),
  },
])
