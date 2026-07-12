# Unreleased (since v1.0.4 / 2026-05-31)

### 2026-05-31

- **chore**: Bumped version to `1.0.4`; updated `@mbler/mcx-server` to `^0.1.1-rc.1` (`15c05cb`)

### 2026-06-08

- **test**: Migrated extension tests to Vitest; added 4 MCX language plugin tests (`939421f`)

### 2026-06-09

- **fix**: Fixed description typo `Lanuage` → `Language` (`ffa7ed0`)
- **fix**: Fixed command title: `Restart Lanuage Server` → `Restart Language Server` (`ffa7ed0`)
- **fix**: Removed dead code; improved noop comment clarity in `ensureMCXLanguage` (`ffa7ed0`)
- **chore**: Added ISSUE_TEMPLATE and changelog directories (`5d866ba`, `f08694e`)
- **chore**: Added CODE_OF_CONDUCT.md (Contributor Covenant v2.1) (`609011a`)

### 2026-06-13

- **feat**: Added localization support for "Restart Language Server" command (`86f2379`)
- **fix**: Updated server deps; fixed `typeof` type reference; added image extensions (`7a215ac`)
- **chore**: Bumped `@mbler/mcx-server` to `0.1.1-rc.3`, extension to `1.0.5` (`36aac3d`)

### 2026-06-27

- **fix**: Removed hardcoded absolute path in bundled output; added `output.paths` for `@mbler/mcx-core` (`3b2a330`)

### 2026-06-28

- **chore**: Updated `@mbler/mcx-core` to `0.1.2-rc.10`; bumped `@mbler/mcx-server` to `0.1.2-rc.2`; added `packageManager` to server pkg (`c2a5c7d`, `90c7f5e`, `ca949c0`)

### 2026-06-29

- **fix**: Added ts/js to LSP `documentSelector` so unsaved edits update MCX types (`408b147`)
- **fix**: Added json to `documentSelector` (`068097f`)
- **fix**: Removed ts/js/json from `documentSelector`; forward TS changes via `didChangeWatchedFiles` with debounce (`9a802ee`)
- **fix**: Removed hardcoded paths from server build (`f93f7f9`)
- **test**: Added Vitest config; 66% test coverage; fixed extension packaging (`b09c414`)
- **chore**: Bumped extension to `1.0.6` → `1.0.9` (`0d0ffd4`, `068097f`, `57b3374`, `fa7884c`)

### 2026-07-08

- **fix(vscode)**: Performance and completion improvements (`187cc0a`)
- **fix**: Restored TS/JS file watchers (needed for external changes) (`2d9ae52`)
- **fix**: Event prop definition navigates value to script function (`d20ddf9`)

### 2026-07-11

- **fix**: Activate on `.mcx` open; fixed script block features (`03247fa`)
