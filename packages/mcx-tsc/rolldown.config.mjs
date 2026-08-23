import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

export default defineConfig({
  input: 'src/index.ts',
  output: {
    dir: './dist',
    entryFileNames: '[name].js',
    format: 'esm',
    sourcemap: false,
  },
  external: [
    '@mbler/mcx-server',
    '@volar/language-core',
    '@volar/typescript/lib/quickstart/runTsc.js',
    /@mbler\/*/,
    /typescript\/*/,
  ],
  platform: 'node',
  plugins: [
    dts(),
  ],
});
