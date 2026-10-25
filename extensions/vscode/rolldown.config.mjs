// @ts-check
import { defineConfig } from 'rolldown'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { rm } from 'node:fs/promises'

function createPluginPack() {
  return {
    name: 'create-plugin-pack',
    closeBundle() {
      const dir = 'node_modules/mcx-typescript-plugin-pack'
      const entry = path.join(dir, 'index.js')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(
        entry,
        "module.exports = require('../../dist/ts-plugin.js').default;\n",
      )
    },
  }
}

/**
 * Ship a tiny `typescript` stub instead of the real 20MB+ package.
 * At runtime it forwards to the TypeScript bundled with VS Code itself:
 * - server child process: MCX_TYPESCRIPT_PATH / --tsdk (set by the client)
 * - extension host: derived from process.execPath (<app>/resources/app)
 */
function writeTypescriptStub() {
  return {
    name: 'write-typescript-stub',
    closeBundle() {
      const dir = path.join('dist', 'node_modules', 'typescript')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify(
          {
            name: 'typescript',
            version: '0.0.0-vscode-stub',
            main: 'index.js',
          },
          null,
          2,
        ),
      )
      fs.writeFileSync(
        path.join(dir, 'index.js'),
        [
          "const fs = require('node:fs')",
          "const path = require('node:path')",
          'function resolveTarget() {',
          '  const envPath = process.env.MCX_TYPESCRIPT_PATH',
          '  if (envPath && fs.existsSync(envPath)) return envPath',
          "  const tsdkArg = process.argv.find(a => a.startsWith('--tsdk='))",
          '  if (tsdkArg) {',
          "    const candidate = tsdkArg.slice('--tsdk='.length).replace(/\\\\/g, '/') + '/typescript.js'",
          '    if (fs.existsSync(candidate)) return candidate',
          '  }',
          '  const exeDir = path.dirname(process.execPath)',
          '  const candidates = [',
          "    path.join(exeDir, 'resources', 'app', 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js'),",
          "    path.join(exeDir, 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js'),",
          "    path.join(exeDir, 'node_modules', 'typescript', 'lib', 'typescript.js')",
          '  ]',
          '  for (const c of candidates) if (fs.existsSync(c)) return c',
          "  throw new Error('[mcx] cannot locate the TypeScript module shipped with VS Code')",
          '}',
          'module.exports = require(resolveTarget())',
          '',
        ].join('\n'),
      )
    },
  }
}

function inlineBabelRequires() {
  return {
    name: 'inline-babel-requires',
    /**
     * @param {string} code
     * @param {string} id
     * @returns {string | null}
     */
    transform(code, id) {
      if (id.includes('mcx-core') && id.endsWith('.js')) {
        const result = code.replace(/__require\("@babel\/parser"\)/g, 'Parser')
        if (result !== code) return result
      }
      return null
    },
  }
}

const commonExternal = ['vscode', 'typescript', /^node:/]

/**
 * `external: ['typescript']` only matches ESM import specifiers, so the
 * `require('typescript')` calls inside `@typescript-eslint/typescript-estree`
 * (pulled in by the mcx ESLint plugin) used to inline the whole 8 MB compiler
 * into the bundle. Resolving it as an external by hand keeps the parser
 * working — it loads the TypeScript shipped with VS Code through the stub
 * `writeTypescriptStub()` writes.
 */
function externalizeTypeScript() {
  return {
    name: 'externalize-typescript',
    enforce: 'pre',
    /**
     * @param {string} source
     * @returns {{ id: string, external: true } | undefined}
     */
    resolveId(source) {
      if (source === 'typescript' || source.startsWith('typescript/')) {
        return { id: source, external: true }
      }
      return undefined
    },
  }
}

const require = createRequire(import.meta.url)

/** Transitive dependencies of `name`, read from the installed package.json. */
function collectDependencies(name, seen = new Set()) {
  if (seen.has(name)) return seen
  seen.add(name)
  let dir
  try {
    dir = path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    try {
      dir = path.dirname(require.resolve(name))
    } catch {
      return seen
    }
  }
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8'))
      if (pkg.name === name) {
        for (const dep of Object.keys(pkg.dependencies ?? {})) {
          collectDependencies(dep, seen)
        }
        break
      }
    } catch {
      // unreadable manifest: treat the package as a leaf
    }

    }
    dir = path.dirname(dir)
  }
  return seen
}

/** Package name of a module id, coping with pnpm's `.pnpm/<pkg>@<ver>` layout. */
function packageNameOf(id) {
  const parts = id.split(/[\\/]node_modules[\\/]/).pop().split(/[\\/]/)
  if (!parts[0]) return ''
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0]
}

/**
 * Everything reachable from the `.mcx` linter. Those modules must not be put
 * in the eagerly loaded `vendor` chunk: eslint and the TypeScript parser are
 * only needed once a `.mcx` file is open, and together they are ~3 MB.
 */
const LINT_DEPENDENCIES = (() => {
  const all = new Set()
  for (const entry of ['eslint', '@typescript-eslint/parser', '@mbler/eslint-plugin-mcx']) {
    for (const dep of collectDependencies(entry)) {
      all.add(dep)
    }
  }
  return all
})()

function isLintDependency(id) {
  return LINT_DEPENDENCIES.has(packageNameOf(id))
}

export default defineConfig([
  // Main extension-host + language-server build.  `@mbler/mcx-core` is only
  // reachable through dynamic imports here, so it (and its typescript
  // dependency) lands in a lazy chunk instead of the eager vendor chunk.
  {
    input: {
      extension: './src/extension.ts',
      client: './src/client/index.ts',
      server: './src/server-entry.ts',
    },
    output: {
      dir: './dist',
      entryFileNames(chunkInfo) {
        if (chunkInfo.name === 'server') return 'server/[name].js'
        return '[name].js'
      },
      format: 'cjs',
      exports: 'named',
      minify: true,
      manualChunks(id) {
        if (!id.includes('node_modules')) return undefined
        if (
          id.includes('@mbler/mcx-core') ||
          id.includes('@mbler+mcx-core') ||
          id.includes('@babel') ||
          id.includes('+babel') ||
          /[\\/]typescript[\\/]/.test(id)
        ) {
          return undefined
        }
        // The .mcx linter (eslint + the mcx plugin) is ~3 MB and only needed
        // once a .mcx file is open, so it stays out of the eager vendor chunk.
        if (isLintDependency(id)) {
          return undefined
        }
        if (id.includes('vscode-languageclient')) return 'lsp-client'
        if (id.includes('vscode-languageserver')) return 'lsp'
        if (id.includes('@volar') || id.includes('vscode-nls')) return 'volar'
        return 'vendor'
      },
    },
    external: commonExternal,
    plugins: [
      {
        name: 'rm-old-dist',
        async buildStart() {
          await rm('./dist', { recursive: true, force: true })
        },
      },
      externalizeTypeScript(),
      inlineBabelRequires(),
      createPluginPack(),
      writeTypescriptStub(),
    ],
  },
  // The tsserver plugin runs inside VS Code's own TypeScript process where
  // `require('typescript')` resolves natively — keep it a standalone bundle.
  {
    input: { 'ts-plugin': './src/ts-plugin-entry.ts' },
    output: {
      dir: './dist',
      entryFileNames: '[name].js',
      format: 'cjs',
      exports: 'named',
      minify: true,
    },
    external: commonExternal,
    plugins: [inlineBabelRequires()],
  },
])
