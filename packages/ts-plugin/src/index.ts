import { createLanguageServicePlugin } from "@volar/typescript/lib/quickstart/createLanguageServicePlugin.js";
import { createMCXLanguagePlugin } from "@mbler/mcx-server";

const plugin = createLanguageServicePlugin((ts: typeof import("typescript"), info: { languageServiceHost: import("typescript").LanguageServiceHost }) => {
  console.error('[MCX_TSPLUGIN] Plugin loaded!')

  const host = info.languageServiceHost as import('typescript').LanguageServiceHost & {
    getExtraFileExtensions?: () => { extension: string; isMixedContent: boolean; scriptKind: number }[]
  };

  const origCompilationSettings = host.getCompilationSettings.bind(host);
  host.getCompilationSettings = () => {
    const opts = origCompilationSettings();
    if (opts.allowNonTsExtensions !== true) {
      console.error('[MCX_TSPLUGIN] Setting allowNonTsExtensions=true')
      opts.allowNonTsExtensions = true
    }
    if (opts.allowArbitraryExtensions !== true) {
      console.error('[MCX_TSPLUGIN] Setting allowArbitraryExtensions=true')
      opts.allowArbitraryExtensions = true
    }
    return opts;
  };

  const origGetExtraFileExtensions = host.getExtraFileExtensions?.bind(host);
  if (origGetExtraFileExtensions) {
    host.getExtraFileExtensions = () => {
      const orig = origGetExtraFileExtensions() ?? [];
      const existing = new Set(orig.map(e => e.extension));
      if (!existing.has("mcx")) {
        console.error('[MCX_TSPLUGIN] Adding .mcx to extraFileExtensions')
        orig.push({ extension: "mcx", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred });
      }
      return orig;
    };
  }

  console.error('[MCX_TSPLUGIN] Plugin setup complete, returning language plugins')

  return {
    languagePlugins: [createMCXLanguagePlugin(ts)],
  };
});

export = plugin;
