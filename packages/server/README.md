# @mbler/mcx-server

The MCX language server — completions, hover, diagnostics and formatting for `.mcx` files, built on [Volar](https://github.com/volarjs/volar.js).

It powers the [MCX VS Code extension](https://marketplace.visualstudio.com/items?itemName=ruanhor.mcx-vscode-client) and can be embedded in any editor that speaks LSP.

## Install

```bash
pnpm add -D @mbler/mcx-server
```

## Use

### Editor / LSP client

```bash
npx mcx-language-server          # speaks LSP over stdio
npx mcx-language-server --version
```

Point your client at the `mcx-language-server` binary and register `.mcx` as the document language. The TypeScript SDK used for `.mcx` script blocks can be passed as `--tsdk=<path-to-lib>`, or through the `MCX_TYPESCRIPT_PATH` environment variable.

### Programmatic

| Entry | Contents |
| --- | --- |
| `@mbler/mcx-server` | `createMCXLanguagePlugin()` and the plugin it returns |
| `@mbler/mcx-server/server` | the bundled server, run it as a child process |
| `@mbler/mcx-server/completion` | portable completion data — `types`, `builtin`, `registry`, `manifest`, `config` |

```ts
import { createMcxCompletionRegistry } from '@mbler/mcx-server/completion';

const registry = createMcxCompletionRegistry({
  name: 'my-plugin',
  rootTags: ['Shop'],
  tags: [{ name: 'Shop', children: ['Button'] }],
});

registry.rootTags(); // ['Shop']
```

## Compiler-plugin completions

Tags and attributes contributed by MCX compiler plugins (`mcxPlugin` in `mbler.config.js`) complete like the built-in DSL. The data lives in `.mbler/mcx-completion.json`:

- mbler writes that file during a build;
- when it is missing or older than the project's `mbler.config.*`, the server derives the contributions from the config itself (plugin factories are called once, throwing factories are skipped) and writes the file back, so **no build is required**;
- every `mbler.config.*` under a workspace folder is scanned, because a workspace folder is not necessarily a project root;
- a config that cannot be imported falls back to the last manifest, and a project that stops contributing plugins removes its stale file.

A plugin declares its contribution on the `McxPlugin` object:

```ts
import type { McxPlugin } from '@mbler/mcx-types';

export function shopPlugin(): McxPlugin {
  return {
    name: 'my-shop',
    completion: {
      name: 'my-shop',
      rootTags: ['Shop'],
      tags: [
        {
          name: 'Shop',
          container: true,
          children: ['Button'],
          attributes: [{ name: 'currency', values: ['coin', 'gem'] }],
        },
      ],
    },
  };
}
```

See the [JSON UI plugin](https://github.com/RuanhoR/mcx-core/tree/main/packages/official-plugin/jsonui) for a full example.

## Related

- [MCX CORE](https://github.com/RuanhoR/mcx-core) — compiler and `mbler` CLI
- [MCX Language Server](https://github.com/RuanhoR/mcx-language-server) — this repository
- [MCX Template](https://github.com/RuanhoR/mcx-template) — starter addon

## License

MIT
