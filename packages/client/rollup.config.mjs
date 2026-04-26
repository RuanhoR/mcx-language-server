import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import tsPlugin from "@rollup/plugin-typescript";

const plugins = [
  commonjs(),
  resolve({ preferBuiltins: true }),
  tsPlugin({ tsconfig: "./tsconfig.json" }),
];

const external = [
  /^node:/,
  "vscode",
  "@volar/vscode",
  "@mbler/mcx-core",
  "vscode-languageclient",
  "vscode-languageclient/node",
];

export default {
  input: {
    extension: "./src/extension.ts",
    client: "./src/client/index.ts",
  },
  output: {
    dir: "./dist",
    entryFileNames: "[name].js",
    format: "cjs",
    // sourcemap: true,
    exports: "named",
  },
  onwarn(warning, warn) {
    if (
      warning.code === "CIRCULAR_DEPENDENCY" &&
      typeof warning.message === "string" &&
      warning.message.includes("/semver/")
    ) {
      return;
    }
    warn(warning);
  },
  external,
  plugins,
};
