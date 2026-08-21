// @ts-check
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const _require = createRequire(import.meta.url)
const rootDir = path.resolve(import.meta.dirname, "../..")
const distDir = path.resolve(import.meta.dirname, "../dist")

// 1. Copy server bundle
const serverSrc = path.join(rootDir, "packages/server/dist/server.js")
const serverDest = path.join(distDir, "server/server.js")
fs.mkdirSync(path.dirname(serverDest), { recursive: true })
fs.copyFileSync(serverSrc, serverDest)
console.error(`[copy-bundles] Copied server -> ${path.relative(rootDir, serverDest)}`)

// 2. Copy ts-plugin bundle
const tsPluginSrc = path.join(rootDir, "packages/ts-plugin/dist/index.js")
const tsPluginDest = path.join(distDir, "ts-plugin.js")
fs.copyFileSync(tsPluginSrc, tsPluginDest)
console.error(`[copy-bundles] Copied ts-plugin -> ${path.relative(rootDir, tsPluginDest)}`)

// 3. Copy TypeScript libs (*.d.ts only)
const tsPkg = path.dirname(_require.resolve("typescript/package.json"))
const tsLibSrc = path.join(tsPkg, "lib")
const tsLibDest = path.join(distDir, "server/lib")
if (fs.existsSync(tsLibSrc)) {
  fs.cpSync(tsLibSrc, tsLibDest, {
    recursive: true,
    force: true,
    filter: (f) => fs.statSync(f).isDirectory() || /\.d\.ts$/.test(f),
  })
  console.error(`[copy-bundles] Copied TypeScript libs -> ${path.relative(rootDir, tsLibDest)}`)
}

// 4. Create plugin pack shim
const pluginDir = path.join(distDir, "../node_modules/mcx-typescript-plugin-pack")
const pluginEntry = path.join(pluginDir, "index.js")
fs.mkdirSync(pluginDir, { recursive: true })
fs.writeFileSync(pluginEntry, "module.exports = require('../../dist/ts-plugin.js');\n")
console.error(`[copy-bundles] Created plugin pack shim`)

console.error("[copy-bundles] Done!")
