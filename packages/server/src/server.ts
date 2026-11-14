import { createServerBase } from "@volar/language-server/lib/server.js";
import { provider as httpFileSystemProvider, listenEditorSettings } from "@volar/language-server/lib/fileSystemProviders/http.js";
import { provider as nodeFileSystemProvider } from "@volar/language-server/lib/fileSystemProviders/node.js";
import { createTypeScriptProject } from "@volar/language-server/lib/project/typescriptProject.js";
import { create as createTypeScriptServices } from "volar-service-typescript";
import * as lsp from "vscode-languageserver/node.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createMCXLanguagePlugin } from "./plugin/index.js";
import {
  collectWorkspaceContributions,
  createMcxCompletionRegistry,
  type McxCompletionContribution,
} from "./completion/index.js";

const connection = lsp.createConnection(lsp.ProposedFeatures.all);
const immediate = (globalThis as unknown as { setImmediate?: (...args: unknown[]) => void }).setImmediate;

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

// Plugin contributions currently in effect, re-read from disk on demand.
let completionContributions: McxCompletionContribution[] = [];

// Workspace roots of the current project, captured at initialize so the
// completion manifest can be re-read when plugins change during a session.
let workspaceRoots: string[] = [];

/** Convert a `file://` URI into a usable path, ignoring non-file URIs. */
function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/**
 * Compiler plugins describe their tags in `.mbler/mcx-completion.json`. mbler
 * writes that file during a build; when no build has run yet the contributions
 * are derived from each project's `mbler.config.*` and written back with `fs`,
 * so plugin tags complete in the editor without a build. Every workspace folder
 * is scanned because a workspace folder is not necessarily the project root.
 */
async function readCompletionContributions(): Promise<McxCompletionContribution[]> {
  const byName = new Map<string, McxCompletionContribution>();
  for (const root of workspaceRoots) {
    try {
      const synced = await collectWorkspaceContributions(root);
      for (const project of synced) {
        for (const contribution of project.contributions) {
          if (!byName.has(contribution.name)) byName.set(contribution.name, contribution);
        }
      }
    } catch {
      // a broken project in one folder must not hide the others
    }
  }
  return [...byName.values()];
}

async function reloadCompletionData(): Promise<void> {
  completionContributions = await readCompletionContributions();
}

let project: ReturnType<typeof createTypeScriptProject>;

// Set of URIs that need fresh reads from disk, bypassing all Volar caches.
const dirtyUris = new Set<string>();

// Unsaved (in-memory) contents of ts/js/json documents, pushed by the client.
// Those documents are not in the documentSelector, so the server would only
// see their content after save; the overrides let the TypeScript project read
// the live editor state instead of the stale disk file.
const contentOverrides = new Map<string, string>();

/**
 * Normalize a file URI into a stable key. The client sends
 * `file:///d%3A/...`-style URIs while the file system layer produces
 * `file:///D:/...`-style ones depending on the caller, so compare decoded
 * paths with a lowercased drive letter.
 */
function normalizeUriKey(uri: string): string {
  let s = uri;
  if (s.startsWith("file://")) {
    try {
      s = decodeURIComponent(s.slice("file://".length));
    } catch {
      s = s.slice("file://".length);
    }
  }
  s = s.replace(/\\/g, "/");
  s = s.replace(/^\/([A-Za-z]):/, (_m, drive: string) => "/" + drive.toLowerCase() + ":");
  return s;
}

/**
 * Monkey-patch server.fileSystem so that readFile/stat bypass
 * internal caches for files in dirtyUris or with unsaved overrides.
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
  const origReadFile = server.fileSystem.readFile.bind(server.fileSystem);
  const origStat = server.fileSystem.stat.bind(server.fileSystem);

  server.fileSystem.readFile = (uri) => {
    const key = normalizeUriKey(uri.toString());
    const override = contentOverrides.get(key);
    if (override !== undefined) {
      return Promise.resolve(override) as ReturnType<typeof origReadFile>;
    }
    if (dirtyUris.has(key)) {
      dirtyUris.delete(key);
      return nodeFileSystemProvider.readFile(uri) as ReturnType<typeof origReadFile>;
    }
    return origReadFile(uri);
  };

  server.fileSystem.stat = (uri) => {
    const key = normalizeUriKey(uri.toString());
    if (contentOverrides.has(key) || dirtyUris.has(key)) {
      // Use numeric literal: FileType.File = 1 (vscode-languageserver FileType
      // may be tree-shaken in bundled output, causing crash at runtime)
      return { type: 1, mtime: Date.now(), ctime: 0, size: -1 };
    }
    return origStat(uri);
  };
}

connection.onInitialize(async (params) => {
  const typescriptServices = createTypeScriptServices(ts);

  workspaceRoots = (params.workspaceFolders ?? [])
    .map(folder => uriToPath(folder.uri))
    .filter((root): root is string => typeof root === "string");
  const rootUri = params.rootUri;
  if (workspaceRoots.length === 0 && typeof rootUri === "string") {
    const root = uriToPath(rootUri);
    if (root) workspaceRoots = [root];
  }
  await reloadCompletionData();
  if (completionContributions.length > 0) {
    // Rebuild the language plugin once, now that the workspace manifest is known.
    mcxLanguagePlugin.completion = createMcxCompletionRegistry(
      ...completionContributions,
    );
  }

  const extraFileExtensionsList: Array<{ extension: string; isMixedContent: boolean; scriptKind: number }> = [];
  if (mcxLanguagePlugin.typescript?.extraFileExtensions) {
    extraFileExtensionsList.push(...mcxLanguagePlugin.typescript.extraFileExtensions);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeProject: any;
  project = createTypeScriptProject(ts, undefined, async () => ({
    languagePlugins: [mcxLanguagePlugin],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setup({ project: proj }: any) {
      activeProject = proj;
      const host = proj.typescript.languageServiceHost as import('typescript').LanguageServiceHost & { getExtraFileExtensions?: () => { extension: string; isMixedContent: boolean; scriptKind: number }[] };
      if (host && extraFileExtensionsList.length) {
        const origCompilationSettings = host.getCompilationSettings?.bind(host);
        if (origCompilationSettings) {
          host.getCompilationSettings = () => {
            const opts = origCompilationSettings();
            opts.allowNonTsExtensions ??= true;
            opts.allowArbitraryExtensions ??= true;
            return opts;
          };
        }
        host.getExtraFileExtensions = () => extraFileExtensionsList;
      }
    },
  }));

  // The auto-import caches (export info map / module specifier cache) of the
  // wrapped TS language service are keyed by the importing file and never
  // invalidated by content changes, so new exports would never show up in
  // completions until a full project reload. Clear them whenever a .mcx
  // dependency changes.
  const clearAutoImportCaches = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (activeProject?.typescript?.languageServiceHost ?? undefined) as any;
    try {
      host?.getModuleSpecifierCache?.()?.clear?.();
      host?.getCachedExportInfoMap?.()?.clear?.();
    } catch {
      // caches may not exist depending on the TS version
    }
  };

  const result = server.initialize(params, project, typescriptServices);

  connection.onNotification("mcx/fileChanged", async (change: { uri: string }) => {
    dirtyUris.add(normalizeUriKey(change.uri));

    // The extension already sends workspace/didChangeWatchedFiles before this
    // notification, which clears the createSys file-tree entry (resetting
    // requestedText to false) AND the readFileCache/statCache in fileSystem.js.
    // We just need to trigger a diagnostics refresh — the TypeScript project
    // stays alive and re-reads the changed file incrementally.
    clearAutoImportCaches();
    server.languageFeatures.requestRefresh(false);
  });

  // Unsaved ts/js/json content pushed by the extension on every edit; the
  // overrides win over disk reads until the file is saved or closed.
  // Completion data for editor-side completion providers. The client passes
  // `refresh: true` after `.mbler/mcx-completion.json` changes so newly added
  // plugins show up without restarting the server.
  connection.onRequest(
    "mcx/completionData",
    async (request?: { refresh?: boolean; workspaceFolders?: string[] }) => {
      if (Array.isArray(request?.workspaceFolders)) {
        const roots = request.workspaceFolders
          .map(uriToPath)
          .filter((root): root is string => typeof root === "string");
        if (roots.length > 0) workspaceRoots = roots;
      }
      if (request?.refresh !== false) {
        await reloadCompletionData();
        mcxLanguagePlugin.completion = createMcxCompletionRegistry(
          ...completionContributions,
        );
      }
      const registry = mcxLanguagePlugin.completion;
      return {
        rootTags: registry.rootTags(),
        scriptLangs: registry.scriptLangs(),
        tags: registry.tags(),
        containers: [...registry.containerTags()],
        contributions: registry.contributions().map(item => item.name),
      };
    },
  );

  connection.onNotification("mcx/fileContent", (change: { uri: string; text?: string | null }) => {
    const key = normalizeUriKey(change.uri);
    if (typeof change.text === "string") {
      contentOverrides.set(key, change.text);
    } else {
      contentOverrides.delete(key);
      dirtyUris.add(key);
    }
    clearAutoImportCaches();
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

  server.fileWatcher.watchFiles([
    "**/*.{mcx,ts,js,json}",
  ]).catch((e) => {
    console.error("[MCX] watchFiles failed:", e);
  });
});

connection.onShutdown(() => {
  server.shutdown();
});

connection.listen();
