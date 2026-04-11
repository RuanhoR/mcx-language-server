import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import tsPlugin from "@rollup/plugin-typescript";

const sharedPlugins = [
  commonjs(),
  resolve({ preferBuiltins: true }),
  tsPlugin({ tsconfig: "./tsconfig.json" }),
];

const external = [
  /^node:/,
  "typescript",
  "@volar/language-core",
  "@volar/language-server",
  "vscode-languageserver",
  "vscode-languageserver/node.js",
  "vscode-uri",
  "@mbler/mcx-core",
];

export default [
  {
    input: "./src/index.ts",
    output: {
      file: "./dist/index.js",
      format: "esm",
      sourcemap: true,
    },
    external,
    plugins: sharedPlugins,
  },
  {
    input: "./src/server.ts",
    output: {
      file: "./dist/server.js",
      format: "esm",
      sourcemap: true,
    },
    external,
    plugins: sharedPlugins,
  },
];
