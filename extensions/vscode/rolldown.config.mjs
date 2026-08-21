// @ts-check
import { defineConfig } from "rolldown"
import path from "node:path"
import fs from "node:fs"
import { createRequire } from "node:module"
import { rm } from "node:fs/promises"
const _require = createRequire(import.meta.url)

function copyTypeScriptLibs() {
  return {
    name: "copy-typescript-libs",
    closeBundle() {
      const tsPkg = path.dirname(_require.resolve("typescript/package.json"))
      const tsLibSrc = path.join(tsPkg, "lib")
      const tsLibDest = "dist/server/lib"
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
      fs.writeFileSync(entry, "module.exports = require('../../dist/ts-plugin.js').default;\n")
    },
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

export default defineConfig({
  input: {
    extension: "./src/extension.ts",
    client: "./src/client/index.ts",
    "ts-plugin": "./src/ts-plugin-entry.ts",
    server: "./src/server-entry.ts",
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
      if (id.includes("node_modules")) {
        if (id.includes("vscode-languageclient")) return "lsp-client"
        if (id.includes("vscode-languageserver")) return "lsp"
        if (id.includes("@volar") || id.includes("vscode-nls")) return "volar"
        return "vendor"
      }
    },
  },
  external: [
    "vscode",
    /^node:/,
  ],
  plugins: [{
    name: "rm-old-dist",
    async buildStart() {
      await rm('./dist', { recursive: true, force: true })
    }
  }, inlineBabelRequires(), createPluginPack(), copyTypeScriptLibs()],
})
