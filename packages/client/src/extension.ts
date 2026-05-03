import {
  CompletionItem,
  CompletionItemKind,
  Hover,
  MarkdownString,
  Position,
  Range,
  commands,
  extensions,
  languages,
  window,
  workspace,
  type CompletionItemProvider,
  type DocumentFormattingEditProvider,
  type ExtensionContext,
  type HoverProvider,
  type TextDocument,
} from "vscode";
import * as mcx from "@mbler/mcx-core";
import type { LanguageClient } from "vscode-languageclient/node.js";
import { createMCXLanguageClient } from "./client/index.js";
import { formatMCXDocument } from "./format/index.js";

interface MCXPosition {
  line: number;
  column: number;
}
interface MCXTokenLike {
  data: string;
  start: MCXPosition;
}
interface MCXTagNode {
  type: "TagNode";
  name: string;
  arr?: Record<string, unknown>;
  start: MCXTokenLike;
  end: MCXTokenLike | null;
}

const TAG_COMPLETIONS = ["script", "Event", "Component", "Ui", "items", "blocks", "entities", "item", "block", "entity"];
const COMMON_ATTRIBUTES = ["id", "lang", "@before", "@after"];
const SCRIPT_LANG_VALUES = ["ts", "js"];
const TS_PLUGIN_ID = "@mbler/mcx-ts-plugin";
const EVENT_KEYWORDS = ["import", "Event", "subscribe", "unsubscribe", "event", "useWorld", "createApp"];

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  client = createMCXLanguageClient(context);
  void client.start();
  void configureTypeScriptPlugin();

  const formattingProvider: DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(document, options) {
      return formatMCXDocument(document, options);
    },
  };

  context.subscriptions.push(
    languages.registerDocumentFormattingEditProvider({ language: "mcx" }, formattingProvider),
  );

  const completionProvider: CompletionItemProvider = {
    provideCompletionItems(document, position) {
      return provideMCXCompletions(document, position);
    },
  };

  context.subscriptions.push(
    languages.registerCompletionItemProvider(
      { language: "mcx" },
      completionProvider,
      "<",
      " ",
      ":",
      "@",
      "=",
      "\"",
      "'",
    ),
  );

  const hoverProvider: HoverProvider = {
    provideHover(document, position) {
      return provideMCXHover(document, position);
    },
  };

  context.subscriptions.push(
    languages.registerHoverProvider({ language: "mcx" }, hoverProvider),
  );

  const openDisposable = workspace.onDidOpenTextDocument((doc) => {
    void ensureMCXLanguage(doc);
  });
  context.subscriptions.push(openDisposable);

  for (const doc of workspace.textDocuments) {
    void ensureMCXLanguage(doc);
  }

  const restartCommand = commands.registerCommand("mcx.restart.language", () => {
    void restartLanguageServer(context);
  });
  context.subscriptions.push(restartCommand);

  context.subscriptions.push({
    dispose: () => {
      void client?.stop();
    },
  });
}

export async function deactivate(): Promise<void> {
  if (!client) {
    return;
  }

  await client.stop();
  client = undefined;
}

async function restartLanguageServer(context: ExtensionContext): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }

  client = createMCXLanguageClient(context);
  await client.start();
  await configureTypeScriptPlugin();
  window.showInformationMessage("MCX language server restarted successfully.");
}

async function configureTypeScriptPlugin(): Promise<void> {
  const tsExtension = extensions.getExtension("vscode.typescript-language-features");
  if (!tsExtension) {
    return;
  }

  await tsExtension.activate();

  const api = (tsExtension.exports as { getAPI?: (version: number) => any } | undefined)?.getAPI?.(0);
  if (!api || typeof api.configurePlugin !== "function") {
    return;
  }

  api.configurePlugin(TS_PLUGIN_ID, {
    enabled: true,
    extension: "mcx",
  });
}

async function ensureMCXLanguage(document: TextDocument): Promise<void> {
  if (!document.uri.fsPath.endsWith(".mcx")) {
    return;
  }
  if (document.languageId === "plaintext") {
    try {
      await languages.setTextDocumentLanguage(document, "mcx");
    } catch {
      // noop
    }
  }
}

function provideMCXCompletions(document: TextDocument, position: Position): CompletionItem[] {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const fullLine = document.lineAt(position.line).text;

  if (/<[A-Za-z:_-]*$/.test(linePrefix)) {
    return TAG_COMPLETIONS.map((name) => {
      const item = new CompletionItem(name, CompletionItemKind.Keyword);
      item.insertText = name;
      return item;
    });
  }

  if (!isInsideOpenTag(linePrefix)) {
    return [];
  }

  if (isCompletingScriptLang(linePrefix)) {
    return SCRIPT_LANG_VALUES.map((lang) => {
      const item = new CompletionItem(lang, CompletionItemKind.EnumMember);
      item.insertText = lang;
      item.detail = "script lang";
      return item;
    });
  }

  const scriptBlock = getScriptBlock(document.getText());
  if (scriptBlock && isInsideScriptBlockContent(document, position, scriptBlock)) {
    return provideScriptCompletions(fullLine, position, linePrefix);
  }

  const tagName = currentTagName(linePrefix);
  const attrs = tagName === "script"
    ? [...COMMON_ATTRIBUTES, "lang"]
    : COMMON_ATTRIBUTES;

  return [...new Set(attrs)].map((attr) => {
    const item = new CompletionItem(attr, CompletionItemKind.Property);
    if (attr === "lang" && tagName === "script") {
      item.insertText = 'lang="ts"';
      item.detail = "script language (ts/js)";
    } else {
      item.insertText = attr;
    }
    return item;
  });
}

function provideScriptCompletions(fullLine: string, position: Position, linePrefix: string): CompletionItem[] {
  const completions: CompletionItem[] = [];

  if (/import\s*$/.test(linePrefix) || /import\s+[\w$]*$/.test(linePrefix)) {
    completions.push(
      new CompletionItem("Event", CompletionItemKind.Module),
      new CompletionItem("createApp", CompletionItemKind.Function),
    );
  }

  if (/import\s+[\w$]*\s+from\s+["'][\w./]*$/.test(linePrefix)) {
    completions.push(
      new CompletionItem('"./event"', CompletionItemKind.Reference),
      new CompletionItem('"./events"', CompletionItemKind.Reference),
    );
  }

  if (/ctx\.$/.test(linePrefix) || /ctx\.event/.test(linePrefix)) {
    completions.push(
      new CompletionItem("event", CompletionItemKind.Property),
    );
  }

  if (/\.subscribe\(?["']?$/.test(linePrefix.trim())) {
    const minecraftEvents = [
      "playerJoin", "playerLeave", "playerDie", "playerRespawn",
      "blockBreak", "blockPlace", "itemUse", "itemUseOn",
      "entityHit", "entityDie", "projectileHit",
      "weatherChange", "timeChange",
    ];
    for (const evt of minecraftEvents) {
      const item = new CompletionItem(evt, CompletionItemKind.Event);
      item.detail = "Minecraft event";
      completions.push(item);
    }
  }

  if (/Event\.$/.test(linePrefix)) {
    const eventMethods = ["subscribe", "unsubscribe", "useWorld", "createApp"];
    for (const method of eventMethods) {
      const item = new CompletionItem(method, CompletionItemKind.Method);
      item.detail = "Event method";
      completions.push(item);
    }
  }

  return completions;
}

function provideMCXHover(document: TextDocument, position: Position): Hover | undefined {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const hoverInfo = analyzeHoverPosition(document, position, linePrefix);

  if (!hoverInfo) {
    return undefined;
  }

  const markdown = new MarkdownString();
  markdown.isTrusted = true;

  if (hoverInfo.type === "tag" && hoverInfo.tagName) {
    markdown.appendCodeblock(hoverInfo.tagName, "xml");
    markdown.appendMarkdown("\n\n**MCX Tag**\n\n");

    if (hoverInfo.tagName === "script") {
      markdown.appendMarkdown("Script block for embedded TypeScript/JavaScript code.\n\n");
      markdown.appendMarkdown("**Attributes:** `lang`, `id`, `@before`, `@after`\n");
      markdown.appendMarkdown("**Languages:** `ts`, `js`");
    } else if (hoverInfo.tagName === "Event") {
      markdown.appendMarkdown("Event definition block for minecraft event handlers.\n\n");
      markdown.appendMarkdown("**Attributes:** `id`");
    } else if (hoverInfo.tagName === "Component") {
      markdown.appendMarkdown("Component definition block.\n\n");
      markdown.appendMarkdown("**Attributes:** `id`");
    } else if (hoverInfo.tagName === "Ui") {
      markdown.appendMarkdown("UI definition block.\n\n");
      markdown.appendMarkdown("**Attributes:** `id`");
    } else if (TAG_COMPLETIONS.includes(hoverInfo.tagName)) {
      markdown.appendMarkdown(`MCX built-in tag: \`${hoverInfo.tagName}\`\n\n`);
      markdown.appendMarkdown("Common attributes: `id`, `@before`, `@after`");
    } else {
      markdown.appendMarkdown("MCX custom tag");
    }
  }

  if (hoverInfo.type === "attribute" && hoverInfo.attrName) {
    markdown.appendCodeblock(hoverInfo.attrName, "xml");
    markdown.appendMarkdown("\n\n**MCX Attribute**\n\n");

    if (hoverInfo.attrName === "id") {
      markdown.appendMarkdown("Unique identifier for this element.\n");
    } else if (hoverInfo.attrName === "lang") {
      markdown.appendMarkdown("Script language specification (`ts` or `js`).\n");
    } else if (hoverInfo.attrName === "@before" || hoverInfo.attrName === "@after") {
      markdown.appendMarkdown("Event hook for executing code before/after the main logic.\n");
    }

    if (hoverInfo.attrValue) {
      markdown.appendMarkdown(`\n**Value:** \`${hoverInfo.attrValue}\``);
    }
  }

  return new Hover(markdown, hoverInfo.range);
}

interface HoverInfo {
  type: "tag" | "attribute";
  range?: Range;
  tagName?: string;
  attrName?: string;
  attrValue?: string;
}

function analyzeHoverPosition(
  document: TextDocument,
  position: Position,
  linePrefix: string,
): HoverInfo | undefined {
  const script = getScriptBlock(document.getText());
  if (script && isInsideScriptBlock(document, position, script)) {
    // Let language server / tsserver provide semantic hover in <script>.
    return undefined;
  }

  const tagMatch = linePrefix.match(/<([A-Za-z][\w:-]*)[^>]*$/);
  if (tagMatch && !linePrefix.includes(">")) {
    const tagStart = linePrefix.lastIndexOf("<");
    const tagEnd = linePrefix.length;
    const tagRange = new Range(
      new Position(position.line, tagStart),
      new Position(position.line, tagEnd),
    );
    return {
      type: "tag",
      range: tagRange,
      tagName: tagMatch[1],
    };
  }

  const attrMatch = linePrefix.match(/\s([\w@:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?$/);
  if (attrMatch) {
    const attrRange = getWordRangeAtPosition(document, position);
    if (attrRange) {
      return {
        type: "attribute",
        range: attrRange,
        attrName: attrMatch[1],
        attrValue: attrMatch[2] || attrMatch[3] || attrMatch[4],
      };
    }
  }

  return undefined;
}

function getScriptBlock(source: string): { start: number; end: number } | undefined {
  let parsed: MCXTagNode[] | undefined;
  try {
    parsed = new (mcx as any).AST.tag(source).parseAST() as MCXTagNode[];
  } catch {
    return undefined;
  }

  const scriptTag = parsed.find((node) => node.name === "script");
  if (!scriptTag) {
    return undefined;
  }

  const lineOffsets = computeLineOffsets(source);
  const start = offsetAt(lineOffsets, scriptTag.start.start) + scriptTag.start.data.length;
  const end = scriptTag.end?.start ? offsetAt(lineOffsets, scriptTag.end.start) : start;

  return { start, end };
}

function isInsideScriptBlockContent(document: TextDocument, position: Position, script: { start: number; end: number }): boolean {
  const offset = document.offsetAt(position);
  return offset >= script.start && offset <= script.end;
}

function isInsideScriptBlock(document: TextDocument, position: Position, script: { start: number; end: number }): boolean {
  const offset = document.offsetAt(position);
  return offset >= script.start && offset <= script.end;
}

function isInsideOpenTag(linePrefix: string): boolean {
  const lt = linePrefix.lastIndexOf("<");
  const gt = linePrefix.lastIndexOf(">");
  return lt > gt;
}

function currentTagName(linePrefix: string): string | undefined {
  const match = linePrefix.match(/<([A-Za-z][\w:-]*)[^>]*$/);
  return match?.[1];
}

function isCompletingScriptLang(linePrefix: string): boolean {
  const tag = currentTagName(linePrefix);
  if (tag !== "script") {
    return false;
  }
  return /\blang\s*=\s*(?:"[^"]*|'[^']*|[^\s>]*)?$/.test(linePrefix);
}

function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetAt(lineOffsets: number[], position: MCXPosition): number {
  const lineIndex = Math.max(0, Math.min(lineOffsets.length - 1, position.line - 1));
  return lineOffsets[lineIndex] + Math.max(0, position.column);
}

function getWordRangeAtPosition(document: TextDocument, position: Position): Range | undefined {
  const line = document.lineAt(position.line);
  const lineText = line.text;

  let start = position.character;
  let end = position.character;

  while (start > 0 && /[\w@:-]/.test(lineText[start - 1])) {
    start--;
  }

  while (end < lineText.length && /[\w@:-]/.test(lineText[end])) {
    end++;
  }

  if (start < end) {
    return new Range(
      new Position(position.line, start),
      new Position(position.line, end),
    );
  }

  return undefined;
}
