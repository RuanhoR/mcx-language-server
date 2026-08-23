import { Uri, workspace, env, type ExtensionContext } from "vscode";
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
 */
function locateVscodeTypeScript(): string | undefined {
  const candidates = [
    path.join(
      env.appRoot,
      "extensions",
      "node_modules",
      "typescript",
      "lib",
      "typescript.js"
    ),
    path.join(env.appRoot, "node_modules", "typescript", "lib", "typescript.js"),
    path.join(
      env.appRoot,
      "extensions",
      "typescript-language-features",
      "node_modules",
      "typescript",
      "lib",
      "typescript.js"
    ),
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
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

  const tsModule = locateVscodeTypeScript();
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (tsModule) {
    childEnv.MCX_TYPESCRIPT_PATH = tsModule;
  }
  const preloadPatch = Uri.joinPath(
    context.extensionUri,
    "patch-ts.cjs"
  ).fsPath;
  const runExecArgv = ["--require", preloadPatch];

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { env: childEnv, execArgv: runExecArgv },
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ["--require", preloadPatch, "--nolazy", "--inspect=6010"],
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
