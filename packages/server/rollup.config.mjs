import commjs from "@rollup/plugin-commonjs"
import resolve from "@rollup/plugin-node-resolve";
import tsPlugin from "@rollup/plugin-typescript"
const mainBuildProcess = {
  input: "./src/server.ts",
  output: [
    {
      file: "./dist/server.js",
      format: "esm"
    }
  ],
  external: [
    "vscode"
  ],
  plugin: [
    commjs(),
    resolve(),
    tsPlugin()
  ]
}
export default [mainBuildProcess]