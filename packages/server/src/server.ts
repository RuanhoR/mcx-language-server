import { createServerBase } from "@volar/language-server/lib/server.js";
import { provider as httpFileSystemProvider, listenEditorSettings } from "@volar/language-server/lib/fileSystemProviders/http.js";
import { provider as nodeFileSystemProvider } from "@volar/language-server/lib/fileSystemProviders/node.js";
import { createTypeScriptProject } from "@volar/language-server/lib/project/typescriptProject.js";
import * as lsp from "vscode-languageserver/node.js";
import ts from "typescript";
import { createMCXLanguagePlugin } from "./plugin/index.js";

const connection = lsp.createConnection(lsp.ProposedFeatures.all);
type ImmediateFn = (callback: (...args: any[]) => void, ...args: any[]) => void;
const immediate = (globalThis as { setImmediate?: ImmediateFn }).setImmediate;

const server = createServerBase(connection, {
  timer: {
    setImmediate: (callback, ...args) => {
      if (typeof immediate === "function") {
        immediate(callback, ...args);
        return;
      }
      setTimeout(callback, 0, ...args);
    },
  },
});

const mcxLanguagePlugin = createMCXLanguagePlugin(ts);

connection.onInitialize((params) => {
  const project = createTypeScriptProject(ts, undefined, async () => ({
    languagePlugins: [mcxLanguagePlugin],
  }));

  // Language service plugins are intentionally empty here.
  // We currently rely on the TypeScript project integration + language plugin mappings.
  return server.initialize(params, project, []);
});

connection.onInitialized(() => {
  server.fileSystem.install("file", nodeFileSystemProvider);
  server.fileSystem.install("http", httpFileSystemProvider);
  server.fileSystem.install("https", httpFileSystemProvider);
  listenEditorSettings(server);
  server.initialized();
});

connection.onShutdown(() => {
  server.shutdown();
});

connection.listen();
