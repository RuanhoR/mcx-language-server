import { Uri, workspace, type ExtensionContext } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node.js";
import { middleware as volarMiddleware } from "@volar/vscode";

/**
 * Build a VSCode language client for MCX files.
 */
export function createMCXLanguageClient(context: ExtensionContext): LanguageClient {
  const serverModule = Uri.joinPath(
    context.extensionUri,
    "node_modules",
    "@mbler",
    "mcx-server",
    "dist",
    "server.js",
  ).fsPath;

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ["--nolazy", "--inspect=6010"],
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
      fileEvents: workspace.createFileSystemWatcher("**/*.mcx"),
    },
  };

  return new LanguageClient(
    "mcx-language-server",
    "MCX Language Server",
    serverOptions,
    clientOptions,
  );
}
