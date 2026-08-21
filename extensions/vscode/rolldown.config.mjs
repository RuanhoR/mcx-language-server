// @ts-check
import { defineConfig } from "rolldown"
import { rm } from "node:fs/promises"

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
  },
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
  external: [
    "vscode",
    /^node:/,
  ],
  plugins: [{
    name: "rm-old-dist",
    async buildStart() {
      await rm('./dist', { recursive: true, force: true })
    }
  }, inlineBabelRequires()],
})
