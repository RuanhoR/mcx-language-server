import { Uri, workspace, env, extensions, type ExtensionContext } from "vscode";
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
