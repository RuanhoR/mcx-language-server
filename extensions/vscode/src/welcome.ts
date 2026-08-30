import {
  commands,
  env,
  extensions,
  window,
  workspace,
  type ExtensionContext,
  type WebviewPanel,
} from 'vscode'
import * as fs from 'node:fs'

const WELCOME_VERSION_KEY = 'mcx.welcome.version'
const REPO_URL = 'https://github.com/RuanhoR/mcx-language-server'

let panel: WebviewPanel | undefined

function getExtensionVersion(): string {
  return extensions.getExtension('ruanhor.mcx-vscode-client')?.packageJSON.version ?? ''
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Extract the newest `## [version]` section from the packaged CHANGELOG.md. */
function getLatestChangelog(context: ExtensionContext): string[] | undefined {
  try {
    const file = context.asAbsolutePath('CHANGELOG.md')
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/)
    const items: string[] = []
    let inSection = false
    for (const line of lines) {
      if (/^##\s/.test(line)) {
        if (inSection) break
        inSection = true
        continue
      }
      if (inSection && /^-\s/.test(line)) {
        items.push(line.replace(/^-\s+/, '').trim())
      }
    }
    return items.length > 0 ? items.slice(0, 8) : undefined
  } catch {
    return undefined
  }
}

function buildHtml(context: ExtensionContext, nonce: string): string {
  const version = getExtensionVersion()
  const items = getLatestChangelog(context)
  const changelogHtml = items
    ? `<h2>What's New</h2><ul class="news">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    padding: 2rem 3rem;
    max-width: 720px;
    margin: 0 auto;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  h1 { font-size: 1.9rem; font-weight: 600; margin: 0 0 0.2rem; }
  h1 .accent { color: var(--vscode-charts-green, #7ee787); }
  h2 { font-size: 1.1rem; font-weight: 600; margin: 1.6rem 0 0.6rem;
       border-bottom: 1px solid var(--vscode-panel-border, #333); padding-bottom: 0.3rem; }
  .version { color: var(--vscode-descriptionForeground); margin-bottom: 1.4rem; }
  ul.news { padding-left: 1.2rem; line-height: 1.7; }
  ul.commands { list-style: none; padding-left: 0; line-height: 2; }
  ul.commands code {
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border, #333);
    border-radius: 4px; padding: 0.15rem 0.5rem; margin-right: 0.6rem;
  }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  label { display: flex; align-items: center; gap: 0.5rem; margin-top: 2rem;
          color: var(--vscode-descriptionForeground); cursor: pointer; }
  footer { margin-top: 2.4rem; color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
</style>
</head>
<body>
  <h1>Welcome to <span class="accent">MCX Language</span></h1>
  <div class="version">Version ${escapeHtml(version)}</div>

  ${changelogHtml}

  <h2>Commands</h2>
  <ul class="commands">
    <li><code>MCX: Restart Language Server</code>restart the language server</li>
    <li><code>MCX: Welcome</code>open this page</li>
  </ul>

  <h2>Links</h2>
  <p><a href="${REPO_URL}" class="link">${REPO_URL}</a></p>

  <label><input type="checkbox" id="show-updates" checked> Show welcome page on updates</label>

  <footer>MCX Language Support for VS Code — language server, completions, hover, definitions and build-time type checking for .mcx files.</footer>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('show-updates').addEventListener('change', (e) => {
      vscode.postMessage({ command: 'toggleShowUpdates', value: e.target.checked });
    });
    document.querySelectorAll('a.link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ command: 'openUrl', url: a.href });
      });
    });
  </script>
</body>
</html>`
}

function showWelcomePage(context: ExtensionContext): void {
  if (panel) {
    panel.reveal()
    return
  }

  panel = window.createWebviewPanel('mcx.welcome', 'Welcome to MCX Language', { viewColumn: 1, preserveFocus: true }, {
    enableScripts: true,
  })
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  panel.webview.html = buildHtml(context, nonce)
  panel.webview.onDidReceiveMessage(message => {
    switch (message.command) {
      case 'toggleShowUpdates':
        void context.globalState.update('mcx.welcome.showUpdates', message.value)
        break
      case 'openUrl':
        void env.openExternal(message.url)
        break
    }
  })
  panel.onDidDispose(() => {
    panel = undefined
  })
}

export function registerWelcome(context: ExtensionContext): void {
  context.subscriptions.push(
    commands.registerCommand('mcx.action.welcome', () => showWelcomePage(context)),
  )

  // Show the welcome page automatically after install/update (like Vue/Volar),
  // unless the user turned it off.
  const version = getExtensionVersion()
  const shownFor = context.globalState.get<string>(WELCOME_VERSION_KEY)
  if (shownFor !== version) {
    void context.globalState.update(WELCOME_VERSION_KEY, version)
    const showUpdates = context.globalState.get('mcx.welcome.showUpdates', true)
    const enabled = workspace.getConfiguration('mcx.welcome').get('show', true)
    if (showUpdates && enabled) {
      showWelcomePage(context)
    }
  }
}
