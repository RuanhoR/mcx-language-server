// @ts-check
import { defineConfig } from "rolldown"
import path from "node:path"
import fs from "node:fs"
import { rm } from "node:fs/promises"

function createPluginPack() {
  return {
    name: "create-plugin-pack",
    closeBundle() {
      const dir = "node_modules/mcx-typescript-plugin-pack"
      const entry = path.join(dir, "index.js")
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(entry, "module.exports = require('../../dist/ts-plugin.js').default;\n")
    }
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
    name: "write-typescript-stub",
    closeBundle() {
      const dir = path.join("dist", "node_modules", "typescript")
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "typescript", version: "0.0.0-vscode-stub", main: "index.js" }, null, 2)
      )
      fs.writeFileSync(
        path.join(dir, "index.js"),
        [
          "const fs = require('node:fs')",
          "const path = require('node:path')",
          "function resolveTarget() {",
          "  const envPath = process.env.MCX_TYPESCRIPT_PATH",
          "  if (envPath && fs.existsSync(envPath)) return envPath",
          "  const tsdkArg = process.argv.find(a => a.startsWith('--tsdk='))",
          "  if (tsdkArg) {",
          "    const candidate = tsdkArg.slice('--tsdk='.length).replace(/\\\\/g, '/') + '/typescript.js'",
          "    if (fs.existsSync(candidate)) return candidate",
          "  }",
          "  const exeDir = path.dirname(process.execPath)",
          "  const candidates = [",
          "    path.join(exeDir, 'resources', 'app', 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js'),",
          "    path.join(exeDir, 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js'),",
          "    path.join(exeDir, 'node_modules', 'typescript', 'lib', 'typescript.js')",
          "  ]",
          "  for (const c of candidates) if (fs.existsSync(c)) return c",
          "  throw new Error('[mcx] cannot locate the TypeScript module shipped with VS Code')",
          "}",
          "module.exports = require(resolveTarget())",
          ""
        ].join("\n")
      )
    }
  }
}

function inlineBabelRequires() {
  return {
    name: "inline-babel-requires",
    transform(code, id) {
      if (id.includes("mcx-core") && id.endsWith(".js")) {
        const result = code.replace(/__require\("@babel\/parser"\)/g, "Parser")
        if (result !== code) return result
      }
      return null
    }
  }
}

const commonExternal = ["vscode", "typescript", /^node:/]

export default defineConfig([
  // Main extension-host + language-server build.  `@mbler/mcx-core` is only
  // reachable through dynamic imports here, so it (and its typescript
  // dependency) lands in a lazy chunk instead of the eager vendor chunk.
  {
    input: {
      extension: "./src/extension.ts",
      client: "./src/client/index.ts",
      server: "./src/server-entry.ts"
    },
    output: {
      dir: "./dist",
      entryFileNames(chunkInfo) {
        if (chunkInfo.name === "server") return "server/[name].js"
        return "[name].js"
      },
      format: "cjs",
      exports: "named",
      minify: true,
      manualChunks(id) {
        if (!id.includes("node_modules")) return undefined
        if (
          id.includes("@mbler/mcx-core") ||
          id.includes("@mbler+mcx-core") ||
          id.includes("@babel") ||
          id.includes("+babel") ||
          /[\\/]typescript[\\/]/.test(id)
        ) {
          return undefined
        }
        if (id.includes("vscode-languageclient")) return "lsp-client"
        if (id.includes("vscode-languageserver")) return "lsp"
        if (id.includes("@volar") || id.includes("vscode-nls")) return "volar"
        return "vendor"
      }
    },
    external: commonExternal,
    plugins: [
      {
        name: "rm-old-dist",
        async buildStart() {
          await rm("./dist", { recursive: true, force: true })
        }
      },
      inlineBabelRequires(),
      writeTypescriptStub()
    ]
  },
  // The tsserver plugin runs inside VS Code's own TypeScript process where
  // `require('typescript')` resolves natively — keep it a standalone bundle.
  {
    input: { "ts-plugin": "./src/ts-plugin-entry.ts" },
    output: {
      dir: "./dist",
      entryFileNames: "[name].js",
      format: "cjs",
      exports: "named",
      minify: true
    },
    external: commonExternal,
    plugins: [inlineBabelRequires()]
  }
])
