/* eslint-disable @typescript-eslint/no-var-requires */
// The client passes the TypeScript SDK location (mirrors Volar's --tsdk).
// Must run before the server bundle loads, so this file stays
// requirement-based instead of using static imports.

const tsdkArg = process.argv.find(arg => arg.startsWith('--tsdk='))
if (tsdkArg) {
  const libDir = tsdkArg.slice('--tsdk='.length).replace(/\\/g, '/')
  process.env.MCX_TYPESCRIPT_PATH = libDir + '/typescript.js'
}

require('@mbler/mcx-server/server')
