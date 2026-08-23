/*!
 * Preloaded (node --require) before the language server bundle loads.
 * Redirects every `require('typescript')` to the TypeScript shipped with
 * VS Code (path provided via MCX_TYPESCRIPT_PATH by the extension client).
 */
const Module = require('node:module')
const path = require('node:path')

const requested = process.env.MCX_TYPESCRIPT_PATH
if (requested && path.isAbsolute(requested)) {
  const origResolveFilename = Module._resolveFilename.bind(Module)
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'typescript') {
      return requested
    }
    return origResolveFilename.call(Module, request, ...rest)
  }
} else {
  console.error(
    '[mcx server] MCX_TYPESCRIPT_PATH is not set — falling back to bundled resolution and likely failing.'
  )
}
