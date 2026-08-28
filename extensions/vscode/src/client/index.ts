import { Uri, workspace, env, extensions, type ExtensionContext, type TextDocument, type Disposable } from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node.js";
import { middleware as volarMiddleware } from "@volar/vscode";

/**
 * Locate the TypeScript module shipped inside VS Code itself so the language
 * server can reuse it instead of bundling a multi-megabyte copy.
 * Mirrors Volar's resolveTsdkPath(): appRoot first, Theia fallback second.
 */
function resolveTsdkPath(): string | undefined {
  const vscodeTsdk = path.join(
    env.appRoot,
    "extensions",
    "node_modules",
    "typescript",
    "lib"
  );
  if (fs.existsSync(vscodeTsdk)) {
    return vscodeTsdk;
  }
  const tsExt = extensions.getExtension("vscode.typescript-language-features");
  if (tsExt) {
    // Eclipse Theia layout
    const theiaTsdk = path.join(tsExt.extensionPath, "deps", "typescript", "lib");
    if (fs.existsSync(theiaTsdk)) {
      return theiaTsdk;
    }
  }
  return undefined;
}

/**
 * Build a VSCode language client for MCX files.
 */
export function createMCXLanguageClient(context: ExtensionContext): LanguageClient {
  const serverModule = Uri.joinPath(
    context.extensionUri,
    "dist",
    "server",
    "server.js"
  ).fsPath;

  const tsdk = resolveTsdkPath();
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (tsdk) {
    childEnv.MCX_TYPESCRIPT_PATH = path.join(tsdk, "typescript.js");
    // Also expose to the extension host for the lazy @mbler/mcx-core load.
    process.env.MCX_TYPESCRIPT_PATH = path.join(tsdk, "typescript.js");
  }

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
      args: tsdk ? ["--tsdk=" + tsdk.replace(/\\/g, "/")] : undefined,
      options: { env: childEnv },
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      args: tsdk ? ["--tsdk=" + tsdk.replace(/\\/g, "/")] : undefined,
      options: {
        execArgv: ["--nolazy", "--inspect=6010"],
        env: childEnv,
      },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: "mcx" },
      { pattern: "**/*.mcx" },
    ],
    middleware: volarMiddleware,
    synchronize: {
      fileEvents: [
        workspace.createFileSystemWatcher("**/*.mcx"),
        workspace.createFileSystemWatcher("**/*.ts"),
        workspace.createFileSystemWatcher("**/*.js"),
        workspace.createFileSystemWatcher("**/*.json"),
      ],
    },
  };

  return new LanguageClient(
    "mcx-language-server",
    "MCX Language Server",
    serverOptions,
    clientOptions,
  );
}

const UNSAVED_SYNC_LANGUAGES = new Set(["typescript", "javascript", "json", "jsonc"]);
const UNSAVED_SYNC_DEBOUNCE = 250;

/**
 * Forward unsaved (in-memory) contents of ts/js/json documents to the server.
 *
 * Those languages are intentionally not in the documentSelector (the built-in
 * TS extension owns their language features), so the server would only see
 * their content after save via the file watcher. Without this, completions
 * and diagnostics in `.mcx` files referencing unsaved ts/js/json edits only
 * refresh after save.
 */
export function registerUnsavedContentSync(
  client: LanguageClient,
  subscriptions: Disposable[],
): void {
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const tracked = new Set<string>();

  const isSyncable = (doc: TextDocument): boolean =>
    doc.uri.scheme === "file" && UNSAVED_SYNC_LANGUAGES.has(doc.languageId);

  const send = (uri: Uri, text: string | null): void => {
    // The watched-files (Changed) event resets Volar's createSys file-tree
    // cache (requestedText flags), so the next read actually goes through the
    // patched file system and picks up the override below.
    client.sendNotification("workspace/didChangeWatchedFiles", {
      changes: [{ uri: uri.toString(), type: 2 }],
    });
    client.sendNotification("mcx/fileContent", { uri: uri.toString(), text });
  };

  const schedule = (doc: TextDocument): void => {
    const key = doc.uri.toString();
    tracked.add(key);
    const prev = pendingTimers.get(key);
    if (prev) {
      clearTimeout(prev);
    }
    pendingTimers.set(
      key,
      setTimeout(() => {
        pendingTimers.delete(key);
        send(doc.uri, doc.getText());
      }, UNSAVED_SYNC_DEBOUNCE),
    );
  };

  const release = (doc: TextDocument): void => {
    const key = doc.uri.toString();
    if (!tracked.delete(key)) {
      return;
    }
    const prev = pendingTimers.get(key);
    if (prev) {
      clearTimeout(prev);
      pendingTimers.delete(key);
    }
    send(doc.uri, null);
  };

  subscriptions.push(
    workspace.onDidOpenTextDocument(doc => {
      if (isSyncable(doc)) {
        schedule(doc);
      }
    }),
    workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length > 0 && isSyncable(event.document)) {
        schedule(event.document);
      }
    }),
    workspace.onDidSaveTextDocument(doc => {
      // Disk is authoritative again.
      release(doc);
    }),
    workspace.onDidCloseTextDocument(doc => {
      release(doc);
    }),
    {
      dispose: () => {
        for (const timer of pendingTimers.values()) {
          clearTimeout(timer);
        }
        pendingTimers.clear();
      },
    },
  );

  for (const doc of workspace.textDocuments) {
    if (isSyncable(doc)) {
      schedule(doc);
    }
  }
}
