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

// Set of URIs that need fresh reads from disk, bypassing all Volar caches.
const dirtyUris = new Set<string>();

/**
 * Monkey-patch server.fileSystem so that readFile/stat bypass
 * internal caches for files in dirtyUris.
 *
 * Volar has THREE layers of caching that all persist across project.reload():
 *   1. fileSystem.js → readFileCache, statCache (shared, never cleared)
 *   2. createSys.js  → file tree with requestedText flags (fresh after reload)
 *   3. typescriptProjectLs.js → fsFileSnapshots (module-level, never cleared)
 *
 * Stat returns a different mtime to force fsFileSnapshots invalidation.
 * ReadFile returns live disk content for the same reason.
 * After each "hit" the URI is removed from the set.
 */
function patchFileSystemForDirtyUris(): void {
  const origReadFile: Function = server.fileSystem.readFile.bind(server.fileSystem);
  const origStat: Function = server.fileSystem.stat.bind(server.fileSystem);

  server.fileSystem.readFile = (uri: any): string | undefined => {
    const key = uri.toString();
    if (dirtyUris.has(key)) {
      dirtyUris.delete(key);
      return nodeFileSystemProvider.readFile(uri);
    }
    return origReadFile(uri);
  };

  server.fileSystem.stat = (uri: any): lsp.FileStat | undefined => {
    const key = uri.toString();
    if (dirtyUris.has(key)) {
      return { type: lsp.FileType.File, mtime: Date.now(), ctime: 0, size: -1 };
    }
    return origStat(uri);
  };
}

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
    dirtyUris.add(change.uri);

    // Dispose old TypeScript projects so a fresh createSys is created
    // (fresh file tree with requestedText=false for all files).
    await project.reload();

    // Trigger diagnostics for all open documents. The refresh handler will
    // read changed files through the patched fileSystem methods above,
    // which return live disk content and invalidate fsFileSnapshots.
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

  // Patch fileSystem so mcx/fileChanged can bypass caches
  patchFileSystemForDirtyUris();

  // Set up didChangeWatchedFiles handler so Volar processes file changes.
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
