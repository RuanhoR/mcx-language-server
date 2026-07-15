import { createLanguageServicePlugin } from "@volar/typescript/lib/quickstart/createLanguageServicePlugin.js";
import { createMCXLanguagePlugin } from "@mbler/mcx-server";

const plugin = createLanguageServicePlugin((ts: typeof import("typescript"), info: { languageServiceHost: import("typescript").LanguageServiceHost }) => {
  console.error('[MCX_TSPLUGIN] Plugin loaded! project:', (info.project as any)?.getProjectName?.() ?? 'unknown')

  const host = info.languageServiceHost;

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

  const origGetExtraFileExtensions = (host as any).getExtraFileExtensions?.bind(host);
  if (origGetExtraFileExtensions) {
    (host as any).getExtraFileExtensions = () => {
      const orig: any[] = origGetExtraFileExtensions() ?? [];
      const existing = new Set(orig.map((e: any) => e.extension));
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
