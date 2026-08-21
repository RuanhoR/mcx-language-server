// @ts-check
import { defineConfig } from "rolldown"

function createPluginPack() {
  return {
    name: "create-plugin-pack",
    closeBundle() {
      const dir = "node_modules/mcx-typescript-plugin-pack"
      const entry = require("node:path").join(dir, "index.js")
      if (!require("node:fs").existsSync(dir)) {
        require("node:fs").mkdirSync(dir, { recursive: true })
      }
      require("node:fs").writeFileSync(entry, "module.exports = require('../../dist/ts-plugin.js');\n")
    },
  }
}

export default defineConfig({
  input: "./src/index.ts",
  output: {
    file: "./dist/index.js",
    format: "cjs",
  },
  external: [
    /^node:/,
    "typescript",
  ],
  plugins: [createPluginPack()],
})
