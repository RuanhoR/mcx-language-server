import {
  commands,
  extensions,
  languages,
  window,
  workspace,
  type CompletionItemProvider,
  type DefinitionProvider,
  type DocumentFormattingEditProvider,
  type ExtensionContext,
  type HoverProvider,
  type TextDocument,
} from 'vscode'
import type { LanguageClient } from 'vscode-languageclient/node.js'
import { createMCXLanguageClient, registerUnsavedContentSync } from './client/index.js'
import { formatMCXDocument } from './format/index.js'
import { provideMCXCompletions } from './completion.js'
import { provideMCXHover } from './hover.js'
import { provideMCXDefinition } from './definition.js'
import { registerMcxLinter } from './lint/index.js'
import { registerWelcome } from './welcome.js'

const MCX_EXTENSION_ID = 'ruanhor.mcx-vscode-client'

let client: LanguageClient | undefined
let clientStarted = false

// Patch the TS extension before activation so the mcx typescript server plugin
// is contributed even when this extension activates after the TS one.
patchTypeScriptExtension()

/**
 * Start the language client once. With `onStartupFinished` activation the
 * extension wakes up on every VS Code launch, so skip the server when the
 * workspace has no `.mcx` content — it starts lazily on the first mcx file.
 */
async function ensureClientStarted(context: ExtensionContext): Promise<void> {
  if (clientStarted) {
    return
  }
  clientStarted = true

  client = createMCXLanguageClient(context);
  client.start().then(() => {
    registerUnsavedContentSync(client!, context.subscriptions);
  }).catch((e: Error) => {
    window.showErrorMessage(`MCX language server failed to start: ${e.message}`);
  });

  const tsserverRestartTimer = setTimeout(() => {
    void commands.executeCommand('typescript.restartTsServer')
  }, 3000)
  context.subscriptions.push({
    dispose: () => clearTimeout(tsserverRestartTimer),
  })
}

export function activate(context: ExtensionContext): void {
  const hasOpenMcx = workspace.textDocuments.some(
    doc => doc.languageId === 'mcx' || doc.uri.fsPath.endsWith('.mcx'),
  )
  const startNow = hasOpenMcx
    ? Promise.resolve(true)
    : workspace.findFiles('**/*.mcx', '**/node_modules/**', 1).then(files => files.length > 0)
  void startNow.then(started => {
    if (started) {
      return ensureClientStarted(context)
    }
  })

  const openDisposable = workspace.onDidOpenTextDocument(doc => {
    void ensureMCXLanguage(doc)
    if (doc.languageId === 'mcx' || doc.uri.fsPath.endsWith('.mcx')) {
      void ensureClientStarted(context)
    }
  })
  context.subscriptions.push(openDisposable)

  const formattingProvider: DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(document, options) {
      return formatMCXDocument(document, options)
    },
  }

  context.subscriptions.push(
    languages.registerDocumentFormattingEditProvider(
      { language: 'mcx' },
      formattingProvider,
    ),
  )

  const completionProvider: CompletionItemProvider = {
    provideCompletionItems(document, position) {
      return provideMCXCompletions(document, position)
    },
  }

  context.subscriptions.push(
    languages.registerCompletionItemProvider(
      { language: 'mcx' },
      completionProvider,
      '<',
      '/',
      ' ',
      ':',
      '@',
      '=',
      '"',
      "'",
    ),
  )

  const hoverProvider: HoverProvider = {
    provideHover(document, position) {
      return provideMCXHover(document, position)
    },
  }

  context.subscriptions.push(
    languages.registerHoverProvider({ language: 'mcx' }, hoverProvider),
  )

  const definitionProvider: DefinitionProvider = {
    provideDefinition(document, position, token) {
      return provideMCXDefinition(document, position, token)
    },
  }

  context.subscriptions.push(
    languages.registerDefinitionProvider(
      { language: 'mcx' },
      definitionProvider,
    ),
  )

  registerMcxLinter(context)

  for (const doc of workspace.textDocuments) {
    void ensureMCXLanguage(doc)
    if (doc.languageId === 'mcx' || doc.uri.fsPath.endsWith('.mcx')) {
      void ensureClientStarted(context)
    }
  }

  const restartCommand = commands.registerCommand(
    'mcx.restart.language',
    () => {
      void restartLanguageServer(context)
    },
  )
  context.subscriptions.push(restartCommand)

  registerWelcome(context)

  context.subscriptions.push({
    dispose: () => {
      void client?.stop()
    },
  })

  context.subscriptions.push(
    workspace.onDidSaveTextDocument(document => {
      if (document.languageId === 'mcx' || document.languageId === 'typescript' || document.languageId === 'javascript' || document.languageId === 'json' || document.languageId === 'jsonc') {
        client?.sendNotification('workspace/didChangeWatchedFiles', {
          changes: [{ uri: document.uri.toString(), type: 2 }],
        })
        // Redundant safety net: ensures project refresh even if Volar's file watcher
        // chain drops the workspace/didChangeWatchedFiles notification
        client?.sendNotification('mcx/fileChanged', { uri: document.uri.toString() })
      }
    }),
  )
}

export async function deactivate(): Promise<void> {
  if (!client) {
    return
  }

  await client.stop()
  client = undefined
  clientStarted = false
}

function patchTypeScriptExtension(): void {
  const mcxExtension = extensions.getExtension(MCX_EXTENSION_ID)
  if (mcxExtension) {
    mcxExtension.packageJSON.contributes.typescriptServerPlugins = [
      {
        name: 'mcx-typescript-plugin-pack',
        enableForWorkspaceTypeScriptVersions: true,
      },
    ]
  }
}

async function restartLanguageServer(context: ExtensionContext): Promise<void> {
  if (client) {
    await client.stop()
    client = undefined
  }
  clientStarted = true

  client = createMCXLanguageClient(context)
  try {
    await client.start()
    registerUnsavedContentSync(client, context.subscriptions)
    window.showInformationMessage('MCX language server restarted successfully.')
  } catch (e) {
    window.showErrorMessage(`MCX language server restart failed: ${(e as Error).message}`)
  }
}

async function ensureMCXLanguage(document: TextDocument): Promise<void> {
  if (!document.uri.fsPath.endsWith('.mcx')) {
    return
  }
  const tsLike = ['plaintext', 'typescript', 'javascript', 'typescriptreact', 'javascriptreact']
  if (tsLike.includes(document.languageId)) {
    try {
      await languages.setTextDocumentLanguage(document, 'mcx')
    } catch {
      // unable to set language
    }
  }
}
