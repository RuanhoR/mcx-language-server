// @ts-check
import { defineConfig } from "rolldown"

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

function shimServerGlobals() {
  return {
    name: "shim-server-globals",
    renderChunk(code, chunk) {
      if (chunk.fileName !== "server.js") return null
      const lines = code.split("\n")
      let lastImport = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("import ")) lastImport = i
      }
      if (lastImport === -1) return null
      const shims = `import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
var __dirname = dirname(fileURLToPath(import.meta.url));
var __filename = __dirname + '/lib/typescript.js';
`
      lines.splice(lastImport + 1, 0, shims)
      return lines.join("\n")
    },
  }
}

export default defineConfig({
  input: "./src/server.ts",
  output: {
    file: "./dist/server-ext.js",
    format: "esm",
    sourcemap: false,
  },
  platform: "node",
  external: [
    /^node:/,
  ],
  plugins: [inlineBabelRequires(), shimServerGlobals()],
})
