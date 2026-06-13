# MCX Language support for vscode

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.74.0-blue)](https://code.visualstudio.com/)
[![Github](https://img.shields.io/badge/GitHub-ruanhor%2Fmcx--language--server-blue?logo=github)](https://github.com/RuanhoR/mcx-language-server)

MCX Language support for Visual Studio Code, providing LSP features, syntax highlighting, code completion, hover information, and TypeScript plugin integration for `.mcx` files.

> MCX is a Minecraft data-driven framework and language for creating Minecraft Bedrock Edition content (addons, behaviors, resources).

## Features

- **Syntax Highlighting** — Full `.mcx` file syntax highlighting with embedded TypeScript/JavaScript support
- **Language Server (LSP)** — Automatic LSP start on installation; provides diagnostics, formatting, and more
- **Code Completion** — Smart completions for tags (`<script>`, `<Event>`, `<Component>`, `<Ui>`), attributes (`id`, `lang`, `@before`, `@after`), and script code
- **Hover Info** — Inline documentation on hover for MCX tags and attributes
- **Document Formatting** — Built-in document formatting provider
- **TypeScript Plugin** — Import `.mcx` files in TypeScript with full type checking. No `tsconfig` configuration required

## Installation

### From VS Code Marketplace

Search for `ruanhor.mcx-vscode-client` in the VS Code extensions panel and install.

### From VSIX

```bash
git clone https://github.com/RuanhoR/mcx-language-server.git
cd mcx-language-server/extensions/vscode
pnpm install
pnpm run pack
```

Then install the generated `.vsix` file via VS Code's "Install from VSIX" command.

## Usage

Create `.mcx` files and VS Code will automatically activate the MCX language support. Every `.mcx` file requires a `<script>` tag, plus optionally one of `<Event>`, `<Component>`, or `<Ui>`.

### Event file

```mcx
<Event @after>
PlayerJoin = onPlayerJoin
EntityHitBlock = onEntityHit
</Event>
<script lang="ts">
import { PlayerJoinAfterEvent, EntityHitBlockAfterEvent } from "@minecraft/server";

export function onPlayerJoin(event: PlayerJoinAfterEvent) {
  // handle player join
}

export function onEntityHit(event: EntityHitBlockAfterEvent) {
  // handle entity hit
}
</script>
```

### Component file

```mcx
<Component>
  <items>
    <item id="demo_item.json">item</item>
  </items>
</Component>
<script lang="ts">
import { ItemComponent } from "@mbler/mcx-core";

const item = new ItemComponent({
  id: "demo:my_item",
  name: "Demo Item",
});
item.setMaxStackSize(64);
export { item }
</script>
```

### UI file

```mcx
<Ui>
  <title>My Form</title>
  <button>{{ text }}</button>
</Ui>
<script lang="ts">
export function click() {
  console.log("Button clicked");
}
</script>
```

### App file (entry point)

```mcx
<script lang="ts">
import event from "./event/event.mcx";

event.subscribe();
</script>
```

```typescript
// index.ts
import App from "./app.mcx";
import { createApp } from "@mbler/mcx";
import { world } from "@minecraft/server";

createApp(App).mount(world);
```

### Commands

| Command | Description |
|---------|-------------|
| `MCX: Restart Language Server` | Restarts the MCX language server |

### TypeScript Support

Import `.mcx` files directly in TypeScript to get full type checking:

```typescript
import event from "./event/event.mcx";       // Import event module
import { item } from "./component/ComponentTest.mcx"; // Import component exports
```

The `@mbler/mcx-ts-plugin` is automatically configured — no `tsconfig.json` changes needed.

## Requirements

- VS Code `^1.74.0`
- The extension will automatically download and manage its LSP dependency (`@mbler/mcx-server`)

## Extension Settings

This extension contributes no VS Code settings directly. LSP configuration is managed by the language server itself.

## Known Issues

Please report issues at [GitHub Issues](https://github.com/RuanhoR/mcx-language-server/issues).

## Release Notes

See [CHANGELOG](changelog/) for release notes.

## Related Projects

- [MCX Core](https://github.com/RuanhoR/mcx-core) — Core library and parser
- [MCX Language Server](https://github.com/RuanhoR/mcx-language-server) — Language server (same repo)
- [MCX Template](https://github.com/RuanhoR/mcx-template) — Project template
- [MNX Market](https://github.com/RuanhoR/mnx) — MCX content marketplace
