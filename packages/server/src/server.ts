import { createServerBase } from "@volar/language-server/lib/server.js";
import { provider as httpFileSystemProvider, listenEditorSettings } from "@volar/language-server/lib/fileSystemProviders/http.js";
import { provider as nodeFileSystemProvider } from "@volar/language-server/lib/fileSystemProviders/node.js";
import { createTypeScriptProject } from "@volar/language-server/lib/project/typescriptProject.js";
import { create as createTypeScriptServices } from "volar-service-typescript";
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

let project: ReturnType<typeof createTypeScriptProject>;

connection.onInitialize((params) => {
  console.error("[MCX] onInitialize called");

  const typescriptServices = createTypeScriptServices(ts);
  console.error("[MCX] TypeScript services created, capabilities:", Object.keys(typescriptServices));

  project = createTypeScriptProject(ts, undefined, async () => ({
    languagePlugins: [mcxLanguagePlugin],
  }));

  const result = server.initialize(params, project, typescriptServices);
  console.error("[MCX] server.initialize returned, capabilities:", Object.keys(result.capabilities));

  connection.onNotification("mcx/fileChanged", async (change: { uri: string }) => {
    // Redundant safety net: the Volar fileWatcher (set up via watchFiles above)
    // already handles workspace/didChangeWatchedFiles. This custom notification
    // from the extension ensures a refresh even if the LSP chain falls through.
    console.error("[MCX] mcx/fileChanged:", change.uri);
    server.languageFeatures.requestRefresh(false);
  });

  return result;
});

connection.onInitialized(() => {
  server.fileSystem.install("file", nodeFileSystemProvider);
  server.fileSystem.install("http", httpFileSystemProvider);
  server.fileSystem.install("https", httpFileSystemProvider);
  listenEditorSettings(server);
  server.initialized();

  // CRITICAL: Set up didChangeWatchedFiles handler so Volar processes file changes.
  // Without this, workspace/didChangeWatchedFiles LSP notifications are silently
  // dropped, file system caches never invalidated, and TypeScript types go stale.
  server.fileWatcher.watchFiles([
    "**/*.{mcx,ts,js,json}",
  ]).catch((e) => {
    console.error("[MCX] watchFiles failed:", e);
    // Fallback: manual handler that forces project reload
    connection.onDidChangeWatchedFiles((params) => {
      project.reload();
      server.languageFeatures.requestRefresh(false);
    });
  });
});

connection.onShutdown(() => {
  server.shutdown();
});

connection.listen();
