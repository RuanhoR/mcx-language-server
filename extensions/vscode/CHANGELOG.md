# Changelog

## [Unreleased]

### Features

- `<Event>` block key completion: world event names for the configured side (`@after` / `@before`), extracted from the project's own `@minecraft/server` typings with the same brace-balanced parser as `@mbler/eslint-plugin-mcx` (bundled fallback lists when the package is absent), plus the `McxExtendsBy` directive; `.subscribe(` completions use the same per-project lists
- `<Event>` content formatting: `key = handler` lines normalized to single spaces around `=`, blank-line grouping preserved
- `.mcx` files are linted in the editor with `@mbler/eslint-plugin-mcx` — duplicate root tags, `<Event>` bindings against the project's `@minecraft/server` typings, non-JSON prop values and `<script>` without `lang`. Toggle with `mcx.lint.enable`, relax the event check with `mcx.lint.allowUnknownEvents`
- Attribute completions now come from the compiler's own tables (`src/mcx-tags.ts`, mirrored from `@mbler/mcx-core`'s transforms), so a tag only offers the attributes it actually accepts, in the place where it is valid

### Fixes

- Accepting a tag completion right after typing `<` no longer leaves a stray `>` when VS Code auto-inserts the closing bracket (the completion range now consumes the auto-inserted `>`)
- A trailing incomplete expression in `<script>` (e.g. `luckBlock.`) now surfaces `Identifier expected.` at the broken statement instead of silently merging with the generated code sections
- Completing `@after` / `@before` no longer produces `@@after` — completions replace the partial attribute token (`@a`, `:ti`, `la`, `<close-b`) instead of being inserted after it
- Tags inside `<Component>` no longer all offer `id`: the ten group tags (`items`, `blocks`, …) take no attributes, and their child tags offer the required `id` only
- `<script>` no longer offers `@before` / `@after` / `id` (the compiler reads `lang` only), `<Event>` no longer offers `id`, and `<Form>` / `<Ui>` gained their real attributes (`setup`, `type`)
- Missing component groups (`loot_tables`, `trade_tables`) and the `feature_rules` → `featureRule` mapping are no longer absent from tag completions
- Hover attribute lists are generated from the same tables, so they no longer advertise attributes the compiler rejects (and now document `tick`, `for`, `if`, `value`)

### Internal

- `extension.ts` split into modules (`completion.ts`, `hover.ts`, `definition.ts`, `mcx-ast.ts`, `mcx-text.ts`, `mcx-events.ts`); the formatter reuses the shared AST helpers; bumped to 1.1.7; `@mbler/mcx-core` devDependency `1.1.5-dev.1` → `1.1.5-rc.4`

## [1.1.6] - 2026-08-30

### Features

- Welcome page (`MCX: Welcome` command); shows automatically after install/update (toggle via `mcx.welcome.show`)
- Extension now activates on startup (lazy language server start — the server only runs when `.mcx` files are present)

### Fixes

- Typing `<` inside `<script>` no longer offers top-level MCX tag completions (`Component`, `Ui`, ...) — the script-content check now runs before the tag-completion branch
- `<` and `>` inside `<script>` blocks no longer get rainbow-bracket colors (the `<` `>` pair was declared as a language bracket pair; also removed the `<` auto-closing pair so typing `<` in TypeScript no longer inserts `>`)

## [1.1.5] - 2026-08-29

### Fixes

- Hovering an event `.mcx` import in an app file (e.g. `import event from "./Event.mcx"`) shows the import declaration and module path again, and go-to-definition opens the event file — the import statement is kept in the generated code (with a renamed internal binding) while the binding is still typed as the injected `Event`

## [1.1.4] - 2026-08-28

### Fixes

- Auto-import completions now add the `import` statement in `.mcx` files without import declarations (previously the edit was silently dropped when the `<Event>` block's `McxExtendsBy` injected an import into the generated code)
- Imports inserted by completion now land on their own line after `<script lang="ts">` instead of being appended to the tag line
- Unsaved (in-memory) edits to `.ts` / `.js` / `.json` files now reach the language server immediately — new exports/dependencies show up in `.mcx` completions without saving first
- Event `.mcx` imports in app files are now typed as the injected `Event` (e.g. `event.subscribe()` type-checks); standalone event files keep exporting `MCXFile<"event">`

## [1.1.3] - 2026-08-23

### Features

- Loot table (`<loot_tables>`) and trade table (`<trade_tables>`) component groups; tables emit to `loot_tables/` and `trading/`
- Completions for the new groups and child tags

## [1.1.2] - 2026-08-23

### Features

- Reuses the TypeScript shipped with VS Code (no longer bundled; vsix 4.87 MB → ~1 MB)
- Smarter child-tag completions after unclosed siblings inside `<Ui>` / `<Component>` groups
- Tag-name completion inserts `<xxx></xxx>` snippets

### Fixes

- "Cannot find name 'Record' / 'Object'" — lib files now resolve through VS Code's own TypeScript
- Extension activation failure caused by an eager `require('typescript')` in the vendor chunk

## [1.1.0] - 2026-07-15

### Fixes

- Activate extension on `.mcx` open; fixed script block features
- Performance and completion improvements
- Restored TS/JS file watchers (needed for external changes)
- Event prop definition navigates value to script function

## [1.0.9] - 2026-06-29

### Fixes

- Removed ts/js/json from `documentSelector`; forward TS changes via `didChangeWatchedFiles` with debounce
- Removed hardcoded paths from server build

## [1.0.8] - 2026-06-29

No extension-specific changes beyond version bump.

## [1.0.7] - 2026-06-29

### Fixes

- Added json to LSP `documentSelector`

## [1.0.6] - 2026-06-29

### Fixes

- Added ts/js to LSP `documentSelector` so unsaved edits update MCX types

### Tests

- Added Vitest config; 66% test coverage; fixed extension packaging

## [1.0.5] - 2026-06-13

### Features

- Added localization support for "Restart Language Server" command

### Fixes

- Updated server deps; fixed `typeof` type reference; added image extensions
- Removed hardcoded absolute path in bundled output

### Refactors

- Improved code structure for readability and maintainability

### Chores

- Added ISSUE_TEMPLATE and changelog directories
- Added CODE_OF_CONDUCT.md
- Updated `@mbler/mcx-core` and `@mbler/mcx-server` dependencies

## [1.0.4] - 2026-05-31

### Chores

- Updated package metadata

## [1.0.3] - 2026-05-31

### Features

- **Enhanced hover documentation**: Completely rewritten hover provider with detailed per-tag docs for `<Event>`, `<Component>`, `<Ui>`, `<items>`, `<blocks>`, `<entities>`, `<item>`, `<block>`, `<entity>` — each with descriptions, attribute docs, and child element hints
- **Improved attribute hover**: Better `id`, `lang`, `@before`, `@after` documentation with usage examples
- **Smarter tag/attribute detection**: Rewrote `analyzeHoverPosition` with precise cursor-position-based detection for open/close tags and attribute name/value contexts
- **README update**: Reflected new project structure and usage instructions

### Chores

- Bumped version from `1.0.1` → `1.0.3`
- Updated `@mbler/mcx-server` to `^0.1.1-beta.r20260508.5`
- Updated `@mbler/mcx-ts-plugin` to `0.1.1-alpha.r20260521.1`
- Removed unused constants and simplified tag completions list

## [1.0.1] - 2026-05-08

### Refactors

- **Extension migration**: Moved from `packages/client/` to `extensions/vscode/` for clearer project structure
- Integrated `volar-service-typescript` into the server
- Updated all dependencies to exact versions
- Adjusted Rollup build configuration

### Fixes

- Updated `@mbler/mcx-server` dependency for event import type path fix

## [1.0.0-alpha] - 2026-04-11 — 2026-05-03

Initial development of the VS Code extension for MCX language support, originally located in `packages/client/`.

### Features

- **Syntax highlighting**: TM language grammar for `.mcx` files (`syntaxes/mcx.tmLanguage.json`)
- **Language configuration**: Comment toggling, bracket matching, auto-closing pairs
- **Extension activation**: On `onStartupFinished` and `onLanguage:mcx`
- **MCX export handler**: Support for MCX file type resolution
- **Array highlighting**: Bracket and array syntax colorization
- **Code completion**: `provideScriptCompletions` for `<script>` blocks — import statements, Minecraft events, and Event method suggestions

### Chores

- Initial project scaffolding with Rollup build config
- Package metadata: publisher, repository, activation events
- Added MIT License
- Added `vscode-uri` dependency
