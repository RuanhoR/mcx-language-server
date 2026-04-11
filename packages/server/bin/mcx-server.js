#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("version")) {
  const pkgRaw = await readFile(join(__dirname, "../package.json"), "utf-8");
  const pkg = JSON.parse(pkgRaw);
  process.stdout.write(`${pkg.version}\n`);
} else {
  await import("../dist/server.js");
}
