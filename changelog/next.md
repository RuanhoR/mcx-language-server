# Unreleased (since 2026-05-31)

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

- **fix(server)**: Forward unsaved ts/js/json editor contents to the server (`mcx/fileContent`) and clear the TS auto-import caches on dependency changes, so new exports/deps appear in `.mcx` completions without saving (`bb2e7bf`)
- **fix(server)**: Auto-import code actions now add the import statement in `.mcx` files without import declarations — the `McxExtendsBy` validation section no longer injects a real `import` into the generated virtual code (it would pull the auto-import insert position into the unmapped generated tail, where Volar silently dropped the edit); it now uses a type-level `declare const` reference, and the script content mapping skips the leading newline so imports insert on their own line
