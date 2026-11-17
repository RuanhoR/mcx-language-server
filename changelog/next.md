# Unreleased

### 2026-11-17

- **fix(server)**: built-in completion tables (`Component` groups and children, UI/Form tags, common/per-control attributes) are now derived from the compiler's authoritative exports in `@mbler/mcx-core` instead of a stale hand-copied table — no more invalid `spawnRules` / `featureRules` suggestions, and `ui`, `client_entities`, `attachables`, plain `value`, `:img`, `id` / `:id` / `:for` are now offered
- **test(server)**: `completion.spec.ts` asserts the built-in data equals the core tables so it cannot drift again
- **fix(vscode)**: `mcx-tags.ts` imports the compiler tables from `@mbler/mcx-core` instead of mirroring them; hover docs gained the previously missing component groups/leaves; `setCompletionClient` no longer leaves a stale in-flight request
- **chore(release)**: bump `@mbler/mcx-server` 0.1.6-rc.4, `mcx-vscode-client` 1.1.9, `mcx-tsc` 0.0.2-rc.6, `@mbler/mcx-ts-plugin` 0.1.3-rc.3; `@mbler/mcx-core` dependency → 1.1.5-rc.6, `@mbler/mcx-types` → ^0.0.4-rc.9

### 2026-11-14

- **feat(server)**: plugin completions no longer require a build — every `mbler.config.*` under the workspace folder is scanned (workspace folders are not necessarily project roots), and when a project's `.mbler/mcx-completion.json` is missing or older than `mbler.config.*`, the server derives the contributions from the config itself (dynamic import with a cache-busting query so an edit is picked up without a restart, plugin factories called once, throwing factories skipped) and writes the manifest back with `fs`; the editor's existing manifest watcher then refreshes completion on its own. A broken config falls back to the last manifest, a non-`mcx` project contributes nothing, and a config with no plugins removes the stale file
- **test(server)**: `completion-config.spec.ts` covers factory/array flattening, non-mcx configs, unimportable configs, manifest freshness, re-derivation and stale-file cleanup
- **chore(release)**: bump `@mbler/mcx-server` 0.1.6-rc.3, `mcx-vscode-client` 1.1.8
- **feat(server)**: compiler-plugin completion data — new portable `src/completion/` layer (`types` / `builtin` / `registry` / `manifest`) that stores the MCX DSL tables, merges plugin contributions (root tags, tags, `extends` attribute sets, `scriptLangs`) and reads `.mbler/mcx-completion.json`; `createMCXLanguagePlugin` takes `options.completions`, and the server answers a new `mcx/completionData` request (re-reading the manifest on `refresh: true`, workspace folders from `initialize` or the request)
- **feat(vscode)**: completion now comes from the server, so `mcxPlugin` contributions show up — new `completion-data.ts` caches the `mcx/completionData` answer and layers it over `mcx-tags.ts` (root tags, child tags, container lookup, attribute lists, attribute `values`); a `**/.mbler/mcx-completion.json` watcher refreshes it. `type="jsonui"`, `availability` enums and `<JsonUi>` complete out of the box
- **feat(vscode)**: attribute-value completion inside `attr="` — enum values declared by a tag (built-in or contributed) are offered, with the documented detail text
- **feat(server)**: `@mbler/mcx-server/completion` subpath export (built as a second rolldown entry) so other consumers can reuse the registry without the LSP
- **test(server)**: `completion.spec.ts` covers builtin data, contribution merging, `extends` resolution, manifest parsing and the request payload shape
- **chore(release)**: bump `@mbler/mcx-server` 0.1.6-rc.1, `@mbler/mcx-ts-plugin` 0.1.3-rc.1

### 2026-10-25 (2)

- **fix(server)**: `<script>` imports of `.mcx` event files no longer leak the internal renamed binding (`__mcx_import_0`) into hovers/completions — the module import is now a **type-only** import with an internal name, and the user-facing binding comes from the mapped shadow declaration
- **fix(server)**: the shadowed event binding is now really typed as `Event`, not `any` — `@mbler/mcx-types` is usually not resolvable from the `.mcx` file (pnpm nests it under `@mbler/mcx-core`), and an unresolvable `import()` type is an error type that cannot be detected inside the type system; the server now probes the package on disk (walking up from the `.mcx` file) and inlines the structural shape of the runtime `Event` class when it is not reachable
- **chore(server)**: Bump to 0.1.5-rc.6

### 2026-10-25

- **feat(vscode)**: `<Event>` block key completion — world event names extracted from the project's own `@minecraft/server` typings (same extraction as `@mbler/eslint-plugin-mcx`, bundled fallback lists), plus the `McxExtendsBy` directive; `.subscribe(` completion uses the same per-project lists
- **feat(vscode)**: `<Event>` content formatting — `key = handler` lines normalized to single spaces around `=`, blank-line grouping preserved (collapsed to one)
- **fix(vscode)**: accepting a tag completion after typing `<` no longer leaves a stray `>` when VS Code auto-inserts the closing bracket — the completion range consumes it
- **refactor(vscode)**: `extension.ts` split into modules (`completion.ts`, `hover.ts`, `definition.ts`, `mcx-ast.ts`, `mcx-text.ts`, `mcx-events.ts`); the formatter reuses the shared AST helpers
- **fix(server)**: a trailing incomplete expression in `<script>` (e.g. `luckBlock.`) no longer silently disappears — the generated virtual file now terminates the script content with a mapped `;`, so the TS service reports `Identifier expected.` on the broken statement instead of merging it with the generated tail sections (which previously parsed as a valid member access like `luckBlock.void(...)`)
- **chore(server)**: Bump to 0.1.5-rc.5; `@mbler/mcx-core` dependency `1.1.5-dev.1` → `1.1.5-rc.4` (script error positions now map back to the .mcx file)
- **chore(vscode)**: Bump to 1.1.7

### 2026-08-30

- **feat(vscode)**: Welcome page (`MCX: Welcome`), auto-shown on install/update; startup activation with lazy language server start (`mcx.welcome.show` to disable)
- **fix(vscode)**: Typing `<` inside scripts no longer shows top-level tag completions (script-content check now precedes the tag-completion branch)
- **fix(vscode)**: Removed `<`/`>` from the language bracket pairs and auto-closing pairs — rainbow bracket colorization painted comparison operators red inside `<script>` blocks; typing `<` no longer auto-inserts `>`
- **chore(vscode)**: Bump to 1.1.6

 (since 2026-05-31)

### 2026-06-08

- **test**: Migrated to Vitest with plugin tests — added 4 tests for MCX language plugin; fixed tsconfig extends path; removed old stub test directories (`939421f`)
- **chore**: Fixed tsconfigs to extend base config; removed placeholder test script (`433dd26`)
- **ci**: Fixed `simple-git-hooks` config for CI (added config path and allowed builds) (`3292685`)

### 2026-06-09

- **fix**: Fixed ts-plugin tsconfig extends path; fixed server tsconfig rootDir; fixed launch.json paths; deduplicated Rollup config; renamed `serive`→`service`; removed dead code; fixed `Lanuage`→`Language` typo (`ffa7ed0`)
- **chore**: Added ISSUE_TEMPLATE and changelog directories (`5d866ba`, `f08694e`)
- **chore**: Added CODE_OF_CONDUCT.md (Contributor Covenant v2.1) (`609011a`)

### 2026-06-13

- **feat**: Added localization support for "Restart Language Server" command (`86f2379`)
- **fix(server)**: Updated deps; fixed `typeof` type reference; added image extensions (`7a215ac`)
- **refactor**: Improved code structure for readability and maintainability (`1e0b220`)
- **chore**: Bumped `@mbler/mcx-server` to `0.1.1-rc.3` (`36aac3d`)

### 2026-06-27

- **fix**: Removed hardcoded absolute path in bundled output; added `output.paths` for `@mbler/mcx-core` (`3b2a330`)

### 2026-06-28

- **chore**: Updated `@mbler/mcx-core` to `^0.1.2-rc.8`; fixed bin path (`3a659c1`)
- **chore**: Bumped `@mbler/mcx-server` to `0.1.1-rc.6`, then to `0.1.2-rc.1`, then to `0.1.2-rc.2` (`a819f8c`, `d0f6940`, `90c7f5e`)
- **chore**: Updated `@mbler/mcx-core` dependency to `0.1.2-rc.10` (`c2a5c7d`)
- **chore**: Added `packageManager` to server pkg; updated root to pnpm@11.8.0 (`ca949c0`)

### 2026-06-29

- **test**: Added Vitest config; 66% coverage; fixed extension packaging (`b09c414`)
- **fix**: Added ts/js to LSP `documentSelector` so unsaved edits update MCX types (`408b147`)
- **fix**: Added json to `documentSelector` (`068097f`)
- **fix**: Removed ts/js/json from `documentSelector`; forward TS changes via `didChangeWatchedFiles` with debounce (`9a802ee`)
- **fix**: Removed hardcoded paths from server build; bumped to `0.1.2-rc.3` (`f93f7f9`)
- **chore**: Bumped extension to `1.0.6` → `1.0.9` (`0d0ffd4`, `068097f`, `57b3374`, `fa7884c`)

### 2026-07-08

- **fix(vscode)**: Performance and completion improvements (`187cc0a`)
- **fix**: Restored TS/JS file watchers (needed for external changes) (`2d9ae52`)
- **fix**: Event prop definition navigates value to script function (`d20ddf9`)

### 2026-07-11

- **fix**: Activate on `.mcx` open; fixed script block features (`03247fa`)

### 2026-08-28

- **fix(server)**: App-context `.mcx` event imports are now typed as the injected `Event` (shadowing the import binding in the virtual code); fixed the default-export type using a value (`__MCX_app_data`) as a type
- **fix(server)**: Forward unsaved ts/js/json editor contents to the server (`mcx/fileContent`) and clear the TS auto-import caches on dependency changes, so new exports/deps appear in `.mcx` completions without saving (`bb2e7bf`)
- **fix(server)**: Auto-import code actions now add the import statement in `.mcx` files without import declarations — the `McxExtendsBy` validation section no longer injects a real `import` into the generated virtual code (it would pull the auto-import insert position into the unmapped generated tail, where Volar silently dropped the edit); it now uses a type-level `declare const` reference, and the script content mapping skips the leading newline so imports insert on their own line

### 2026-08-29

- **fix(server)**: Restored hover documentation and go-to-definition on `.mcx` event imports in app files — the generated virtual code now keeps the import statement (with a renamed internal binding) so the source import still resolves to the event module; the `Event` typing from (`bdf60dd`) is unchanged and the source binding maps onto the injected `declare const` declaration
- **fix(server)**: App-data event entries now satisfy both contracts (`e2dbe79`)
- **chore**: Bumped `@mbler/mcx-core` to 1.1.5-dev.1, mcx-server and mcx-tsc to rc, VS Code extension to 1.1.5 (`5d0be7f`, `46a5bbf`, `89fae5d`, `59865d8`)
