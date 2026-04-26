import { createLanguageServicePlugin } from "@volar/typescript/lib/quickstart/createLanguageServicePlugin.js";
import { createMCXLanguagePlugin } from "@mbler/mcx-server";

const plugin = createLanguageServicePlugin((tsModule) => {
  return {
    languagePlugins: [createMCXLanguagePlugin(tsModule)],
  };
});

export = plugin;
