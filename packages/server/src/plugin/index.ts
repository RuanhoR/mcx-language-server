import type { LanguagePlugin, VirtualCode, IScriptSnapshot } from "@volar/language-core";
import type * as ts from "typescript";
import { MCXVirtualCode } from "./code.js";

interface TypeScriptServiceScript {
  code: VirtualCode;
  scriptKind: ts.ScriptKind;
  preventLeadingOffset: boolean;
  extension: string;
}

interface TypeScriptLanguageSupport {
  getServiceScript(virtualCode: VirtualCode): TypeScriptServiceScript | undefined;
  extraFileExtensions: {
    extension: string;
    isMixedContent: boolean;
    scriptKind: ts.ScriptKind;
  }[];
}

export interface MCXLanguagePlugin extends LanguagePlugin<unknown, MCXVirtualCode> {
  typescript: TypeScriptLanguageSupport;
}

/**
 * Create the language plugin used by Volar to parse `.mcx` files.
 */
export function createMCXLanguagePlugin(tsModule: typeof import("typescript")): MCXLanguagePlugin {
  return {
    getLanguageId(scriptId: unknown): string | undefined {
      const id = thisId(scriptId);
      if (id.endsWith(".mcx")) {
        return "mcx";
      }
      return undefined;
    },
    createVirtualCode(_scriptId: unknown, languageId: string, snapshot: IScriptSnapshot): MCXVirtualCode | undefined {
      if (languageId !== "mcx") {
        return undefined;
      }
      return new MCXVirtualCode(snapshot);
    },
    updateVirtualCode(
      _scriptId: unknown,
      virtualCode: MCXVirtualCode,
      newSnapshot: IScriptSnapshot,
    ): MCXVirtualCode {
      virtualCode.update(newSnapshot);
      return virtualCode;
    },
    typescript: {
      extraFileExtensions: [
        {
          extension: "mcx",
          isMixedContent: true,
          scriptKind: tsModule.ScriptKind.JS,
        },
      ],
      getServiceScript(virtualCode: VirtualCode): TypeScriptServiceScript | undefined {
        const scriptCode = virtualCode.embeddedCodes?.find((code) => code.id === "script");
        if (!scriptCode) {
          return undefined;
        }

        const isTypeScript = scriptCode.languageId === "typescript";
        return {
          code: scriptCode,
          scriptKind: isTypeScript ? tsModule.ScriptKind.TS : tsModule.ScriptKind.JS,
          preventLeadingOffset: false,
          extension: isTypeScript ? ".ts" : ".js",
        };
      },
    },
  };
}

export function createMCXVirtualCode(snapshot: IScriptSnapshot): MCXVirtualCode {
  return new MCXVirtualCode(snapshot);
}

function thisId(scriptId: unknown): string {
  if (typeof scriptId === "string") {
    return scriptId;
  }

  if (scriptId && typeof scriptId === "object") {
    const path = (scriptId as { path?: unknown }).path;
    if (typeof path === "string") {
      return path;
    }

    const fsPath = (scriptId as { fsPath?: unknown }).fsPath;
    if (typeof fsPath === "string") {
      return fsPath;
    }
  }

  return String(scriptId ?? "");
}
