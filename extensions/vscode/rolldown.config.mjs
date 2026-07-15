// @ts-check
import { defineConfig } from "rolldown"
import path from "node:path"
import fs from "node:fs"
import { createRequire } from "node:module"
import { rm } from "node:fs/promises"
const _require = createRequire(import.meta.url)

function copyServerDist() {
  return {
    name: "copy-server-dist",
    closeBundle() {
      const serverPkg = path.dirname(path.dirname(_require.resolve("@mbler/mcx-server")))
      const src = path.join(serverPkg, "dist")
      const dest = "dist/server"
      if (fs.existsSync(src)) {
        fs.cpSync(src, dest, {
          recursive: true,
          force: true,
          filter: f => !/\.map$|^index\./.test(path.basename(f)),
        })
      }
      const tsPkg = path.dirname(_require.resolve("typescript/package.json"))
      const tsLibSrc = path.join(tsPkg, "lib")
      const tsLibDest = path.join(dest, "lib")
      if (fs.existsSync(tsLibSrc)) {
        fs.cpSync(tsLibSrc, tsLibDest, {
          recursive: true,
          force: true,
          filter: f => fs.statSync(f).isDirectory() || /\.d\.ts$/.test(f),
        })
      }
    },
  }
}

function createPluginPack() {
  return {
    name: "create-plugin-pack",
    closeBundle() {
      const dir = "node_modules/mcx-typescript-plugin-pack"
      const entry = path.join(dir, "index.js")
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(entry, "module.exports = require('../../dist/ts-plugin.js');\n")
    },
  }
}

function inlineBabelRequires() {
  return {
    name: "inline-babel-requires",
    transform(code, id) {
      if (id.includes("mcx-core") && id.endsWith(".js")) {
        console.error("[inline-babel-requires] transforming:", id)
        const result = code.replace(/__require\("@babel\/parser"\)/g, "Parser")
        if (result !== code) console.error("[inline-babel-requires] REPLACED!")
        return result
      }
      return null
    }
  }
}

const common = {
  input: {
    extension: "./src/extension.ts",
    client: "./src/client/index.ts",
  },
  external: [
    "vscode",
    /^node:/,
  ],
}

export default defineConfig([
  {
    ...common,
    output: {
      dir: "./dist",
      entryFileNames: "[name].js",
      format: "cjs",
      exports: "named",
      minify: true,
      manualChunks(id) {
        if (id.includes("node_modules")) {
          if (id.includes("vscode-languageclient")) return "lsp-client"
          if (id.includes("vscode-languageserver")) return "lsp"
          if (id.includes("@volar") || id.includes("vscode-nls")) return "volar"
          return "vendor"
        }
      },
    },
    plugins:[{
      name: "rm-old-dist",
      async buildStart() {
        await rm('./dist', { recursive: true, force: true })
      }
    }, inlineBabelRequires(), copyServerDist()],
  },
  {
    input: "../../packages/ts-plugin/src/index.ts",
    output: {
      file: "./dist/ts-plugin.js",
      format: "cjs",
    },
    external: [
      /^node:/,
    ],
    resolve: {
      alias: {
        "@mbler/mcx-server": path.resolve("../../packages/server/src/index.ts"),
        "@volar/typescript": path.resolve("../../node_modules/.pnpm/@volar+typescript@2.4.28/node_modules/@volar/typescript"),
      },
    },
    plugins: [inlineBabelRequires(), createPluginPack()],
  },
])
