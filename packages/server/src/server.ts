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
  console.error("[MCX] Client workspace.didChangeWatchedFiles:", JSON.stringify(params.capabilities.workspace?.didChangeWatchedFiles));

  const typescriptServices = createTypeScriptServices(ts);
  console.error("[MCX] TypeScript services created, capabilities:", Object.keys(typescriptServices));

  project = createTypeScriptProject(ts, undefined, async () => ({
    languagePlugins: [mcxLanguagePlugin],
  }));

  const result = server.initialize(params, project, typescriptServices);
  console.error("[MCX] server.initialize returned, capabilities:", Object.keys(result.capabilities));

  connection.onNotification("mcx/fileChanged", async (change: { uri: string }) => {
    console.error("[MCX] mcx/fileChanged:", change.uri);
    // Force project reload + refresh for source file changes (ts/js/json).
    // This bypasses Volar's fileWatcher chain entirely to ensure types update.
    project.reload();
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
  // NOTE: connection.onDidChangeWatchedFiles uses Map.set internally,
  // registering a SECOND handler would REPLACE Volar's handler.
  // We must NOT register another handler for the same method.
  console.error("[MCX] Calling watchFiles...");
  server.fileWatcher.watchFiles([
    "**/*.{mcx,ts,js,json}",
  ]).then(() => {
    console.error("[MCX] watchFiles succeeded");
  }).catch((e) => {
    console.error("[MCX] watchFiles failed:", e);
  });
});

connection.onShutdown(() => {
  server.shutdown();
});

connection.listen();
