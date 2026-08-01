# AGENTS.md

## Repo structure

```
packages/
  server/        @mbler/mcx-server   — Volar-based MCX language server (ESM, rolldown)
  ts-plugin/     @mbler/mcx-ts-plugin — TS Language Service plugin (CommonJS, tsc)
extensions/
  vscode/        mcx-vscode-client   — VS Code extension (CJS, rolldown + vsce)
```

Root is a pnpm workspace (v11.8.0). No lint config exists. Formatter is Prettier with `{ semi: false, singleQuote: true, arrowParens: "avoid" }`.

## Commands (run from the package's own directory)

| Path | Build | TypeCheck | Test | Pack |
|---|---|---|---|---|
| `packages/server` | `pnpm build` (rolldown) | `npx tsc --noEmit` | `pnpm test` (vitest) | — |
| `packages/ts-plugin` | `pnpm build` (tsc) | `npx tsc --noEmit` | `pnpm test` (vitest) | — |
| `extensions/vscode` | `pnpm build` (rolldown) | `pnpm run type-check` | `pnpm test` | `pnpm run pack` (vsce) |

Root scripts: `pnpm prepare` (installs git hooks, run once after clone).

Tests live in `packages/*/__test__/**/*.spec.ts` (vitest). Run from the package's own directory.

## TypeScript config quirks

- **Root** `tsconfig.base.json`: `strict: true`, `verbatimModuleSyntax: true`. Only used by the `server` package.
- **server**: extends base, overrides `module: NodeNext`, `moduleResolution: NodeNext`. Needs `skipLibCheck: true` (vscode-jsonrpc LinkedMap errors without it).
- **ts-plugin**: `module: preserve`, `moduleResolution: bundler`, `skipLibCheck: true`.
- **vscode**: `types: ["vscode"]`, `skipLibCheck: true`.
- **verbatimModuleSyntax** is on in the base → always use `import type` for type-only imports in the server package.

## Architecture notes

- `@mbler/mcx-server` exports `createMCXLanguagePlugin(ts)` and `createMCXVirtualCode(snapshot)` from `packages/server/src/index.ts`.
- **`@mbler/mcx-server` is consumed by the `mcx-tsc` package in the `mcx-core` repo** (the standalone type-checker split out of `mbler`) — it calls `createMCXLanguagePlugin` to type-check `.mcx` files. Keep the exported plugin API backwards-compatible; a breaking change there requires coordinating a `mcx-tsc` release.
- The language server binary entry is `packages/server/src/server.ts` (build target in rolldown config).
- `@mbler/mcx-ts-plugin` wraps `createMCXLanguagePlugin` via Volar's `createLanguageServicePlugin` helper. Published as CommonJS.
- The VS Code extension bundles the server dist and TypeScript lib types into `dist/server/` via the `copyServerDist()` rolldown plugin.

## `@mbler/mcx-core` API notes

- Uses `mcx.PubType.MCXPosition` and `mcx.PubType.ParsedTagNode` (not `PUBTYPE`).
- Parser is `new (mcx as any).AST.tag(source)`, compiler is `(mcx as any).compiler.compileMCXFn(source)`.
- Extension code casts to `any` for these calls.

## Build gotchas

- Server rolldown config inlines `__require("@babel/parser")` replacements and shims CJS globals (`__dirname`, `__filename`) for bundled MBLER chunks.
- VS Code extension rolldown removes `.map` files and non-`index.*` dist files when copying server artifacts.
- `@mbler/mcx-core` uses special `__require` references to `@babel/parser` — the `inlineBabelRequires()` plugin rewrites those to a local var.

## Commit convention

```
type(scope): message
```
Types: `feat|fix|docs|dx|style|refactor|perf|test|workflow|build|ci|chore|types|wip|release`

Enforced by `scripts/verify-commit.mjs` via simple-git-hooks (pre-commit hook on `commit-msg`).

## VS Code extension

- Launches via `.vscode/launch.json` with `--disable-extensions` and `--profile-temp`.
- Activates on `onLanguage:mcx` or `workspaceContains:**/*.mcx`.
- Registers completion, hover, definition, formatting providers in-proc, plus a language client to the MCX server.
- Watches saves of `.mcx/.ts/.js/.json` files and sends both `workspace/didChangeWatchedFiles` and `mcx/fileChanged` to the server.
