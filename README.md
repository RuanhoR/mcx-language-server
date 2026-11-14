# MCX Language server

## About repo

[MCX CORE](https://github.com/RuanhoR/mcx-core) | [MCX Language Server](https://github.com/RuanhoR/mcx-language-server) | [MCX Template](https://github.com/RuanhoR/mcx-template) | [MNX Market](https://github.com/RuanhoR/mnx)

## Repo structure

Root is a pnpm workspace:

```
packages/
  server/     @mbler/mcx-server    — Volar-based MCX language server (ESM, rolldown)
  ts-plugin/  @mbler/mcx-ts-plugin — TS Language Service plugin (CommonJS, tsc)
  mcx-tsc/    mcx-tsc              — standalone MCX type-checker CLI (rolldown; moved from mcx-core)
extensions/
  vscode/     mcx-vscode-client    — VS Code extension (CJS, rolldown + vsce)
```

## Commands (run from the package's own directory)

| Path | Build | TypeCheck | Test | Pack |
|---|---|---|---|---|
| `packages/server` | `pnpm build` (rolldown) | `pnpm type-check` | `pnpm test` (vitest) | — |
| `packages/ts-plugin` | `pnpm build` (tsc) | `pnpm type-check` | `pnpm test` (vitest) | — |
| `packages/mcx-tsc` | `pnpm build` (rolldown) | `pnpm type-check` | — (no tests) | — |
| `extensions/vscode` | `pnpm build` (rolldown) | `pnpm run type-check` | `pnpm test` | `pnpm run pack` (vsce → VSIX) |

Root scripts: `pnpm prepare` (installs git hooks, run once after clone), `pnpm test` (vitest), `pnpm build` (`pnpm -r build`), `pnpm check` (test + lint + type-check). Tests live in `packages/*/__test__/**/*.spec.ts`.

The `mcx-tsc` checker CLI lives in this repo (`packages/mcx-tsc`) and consumes `@mbler/mcx-server` via a `workspace:*` dependency to type-check `.mcx` files.

## Use

### Client

At vscode, download `ruanhor.mcx-vscode-client` plugin

### Cli

Run bash:

```bash
pnpm i -g mbler
```

### Server

```bash
pnpm i @mbler/mcx-server
```

```javascript
import * as mcx from '@mbler/mcx-server'
```
