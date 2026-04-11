import { ExtensionContext, Uri } from "vscode";

function generateClient(context: ExtensionContext) {
  const serverUri = Uri.joinPath(
    context.extensionUri,
    "node_modules",
    "@mbler/mcx-server",
    "dist",
    "server.js"
  )
}