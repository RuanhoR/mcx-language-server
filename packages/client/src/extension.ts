import {
  CompletionItem,
  CompletionItemKind,
  Hover,
  Location,
  MarkdownString,
  Position,
  Range,
  commands,
  languages,
  window,
  workspace,
  type CompletionItemProvider,
  type DefinitionProvider,
  type DocumentFormattingEditProvider,
  type ExtensionContext,
  type HoverProvider,
  type TextDocument,
} from "vscode";
import * as mcx from "@mbler/mcx-core";
import type { LanguageClient } from "vscode-languageclient/node.js";
import { createMCXLanguageClient } from "./client/index.js";
import { formatMCXDocument } from "./format/index.js";

interface RawDefinitionLink {
  targetUri: { toString(): string };
  targetRange: Range;
  targetSelectionRange?: Range;
}
type RawDefinitionResult = Location | RawDefinitionLink;
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
interface ScriptBlock {
  start: number;
  end: number;
  content: string;
  lang: string;
}

const TAG_COMPLETIONS = ["script", "Event", "Component", "Ui", "items", "blocks", "entities", "item", "block", "entity"];
const COMMON_ATTRIBUTES = ["id", "lang", "@before", "@after"];
const SCRIPT_LANG_VALUES = ["ts", "js"];

let client: LanguageClient | undefined;
export function activate(context: ExtensionContext): void {
  client = createMCXLanguageClient(context);
  void client.start();
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
  const definitionProvider: DefinitionProvider = {
    provideDefinition(document, position, _token) {
      return provideMCXDefinition(document, position);
    },
  };
  context.subscriptions.push(
    languages.registerDefinitionProvider({ language: "mcx" }, definitionProvider),
  );
  const hoverProvider: HoverProvider = {
    provideHover(document, position, _token) {
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

  // Recreate and start the client
  client = createMCXLanguageClient(context);
  await client.start();

  // Show success message
  window.showInformationMessage("MCX language server restarted successfully.");
}

async function ensureMCXLanguage(document: TextDocument): Promise<void> {
  if (!document.uri.fsPath.endsWith(".mcx")) {
    return;
  }
  if (document.languageId === "plaintext") {
    try {
      await languages.setTextDocumentLanguage(document, "mcx");
    } catch {
    }
  }
}

function provideMCXCompletions(document: TextDocument, position: Position): CompletionItem[] {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

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

async function provideMCXDefinition(
  document: TextDocument,
  position: Position,
): Promise<Location[] | undefined> {
  const script = getScriptBlock(document.getText());
  if (!script || !isTypeScriptLang(script.lang)) {
    return [];
  }

  const sourceOffset = document.offsetAt(position);
  if (sourceOffset < script.start || sourceOffset > script.end) {
    return [];
  }

  const scriptDoc = await workspace.openTextDocument({
    language: "typescript",
    content: script.content,
  });
  const scriptPosition = scriptDoc.positionAt(sourceOffset - script.start);

  const definitions =
    await commands.executeCommand<RawDefinitionResult[] | undefined>(
      "vscode.executeDefinitionProvider",
      scriptDoc.uri,
      scriptPosition,
    ) ?? [];

  if (definitions.length === 0) {
    return undefined;
  }

  return definitions.map((item) => remapDefinition(item, document, script.start, scriptDoc));
}

function remapDefinition(
  item: RawDefinitionResult,
  sourceDocument: TextDocument,
  scriptStart: number,
  scriptDoc: TextDocument,
): Location {
  if ("targetUri" in item) {
    if (item.targetUri.toString() !== scriptDoc.uri.toString()) {
      const externalRange = item.targetSelectionRange ?? item.targetRange;
      return new Location(item.targetUri as any, externalRange);
    }
    return new Location(
      sourceDocument.uri,
      item.targetSelectionRange
        ? remapRange(item.targetSelectionRange, sourceDocument, scriptStart, scriptDoc)
        : remapRange(item.targetRange, sourceDocument, scriptStart, scriptDoc),
    );
  }

  if (item.uri.toString() !== scriptDoc.uri.toString()) {
    return item;
  }

  return new Location(
    sourceDocument.uri,
    remapRange(item.range, sourceDocument, scriptStart, scriptDoc),
  );
}

function remapRange(
  range: Range,
  sourceDocument: TextDocument,
  scriptStart: number,
  scriptDoc: TextDocument,
): Range {
  const startOffset = scriptStart + scriptDoc.offsetAt(range.start);
  const endOffset = scriptStart + scriptDoc.offsetAt(range.end);
  return new Range(
    sourceDocument.positionAt(startOffset),
    sourceDocument.positionAt(endOffset),
  );
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

function getScriptBlock(source: string): ScriptBlock | undefined {
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
  const lang = String(scriptTag.arr?.lang ?? "js").toLowerCase();
  return {
    start,
    end,
    content: source.slice(start, end),
    lang,
  };
}

function isTypeScriptLang(lang: string): boolean {
  return lang === "ts" || lang === "typescript";
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

function provideMCXHover(document: TextDocument, position: Position): Hover | undefined {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const hoverInfo = analyzeHoverPosition(document, position, linePrefix);

  if (!hoverInfo) {
    return undefined;
  }

  const markdown = new MarkdownString();
  markdown.isTrusted = true;

  switch (hoverInfo.type) {
    case "tag":
      if (hoverInfo.tagName) {
        markdown.appendCodeblock(hoverInfo.tagName, "xml");
        markdown.appendMarkdown(`\n\n**MCX Tag**\n\n`);

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
          markdown.appendMarkdown(`MCX custom tag`);
        }
      }
      break;

    case "attribute":
      if (hoverInfo.attrName) {
        markdown.appendCodeblock(hoverInfo.attrName, "xml");
        markdown.appendMarkdown(`\n\n**MCX Attribute**\n\n`);

        if (hoverInfo.attrName === "id") {
          markdown.appendMarkdown("Unique identifier for this element.\n");
        } else if (hoverInfo.attrName === "lang") {
          markdown.appendMarkdown("Script language specification (`ts` or `js`).\n");
        } else if (hoverInfo.attrName === "@before" || hoverInfo.attrName === "@after") {
          markdown.appendMarkdown("Event hook for executing code before/after the main logic.\n");
        }

        if (hoverInfo.attrValue) {
          markdown.appendMarkdown("\n**Value:** `");
          markdown.appendMarkdown(hoverInfo.attrValue);
          markdown.appendMarkdown("`");
        }
      } else if (hoverInfo.attrName === "@before" || hoverInfo.attrName === "@after") {
        markdown.appendMarkdown("Event hook for executing code before/after the main logic.\n");
      }
      if (hoverInfo.attrValue) {
        markdown.appendMarkdown("\n**Value:** `");
        markdown.appendMarkdown(hoverInfo.attrValue);
        markdown.appendMarkdown("`");
      }
      break;
    case "script-content":
      markdown.appendCodeblock("TypeScript", "typescript");
      markdown.appendMarkdown(`\n\n**Embedded TypeScript**\n\n`);
      markdown.appendMarkdown("This content is executed as TypeScript code in the MCX runtime.");

      // Try to get more specific info from the script content
      const lineContent = document.lineAt(position.line).text;
      const wordMatch = lineContent.match(/[\w]+/g)?.[0];
      if (wordMatch && /^[A-Z][\w]*$/.test(wordMatch)) {
        markdown.appendMarkdown(`\n\n**Type:** Component or Class reference`);
      }
      break;
  }

  return new Hover(markdown, hoverInfo.range);
}

interface HoverInfo {
  type: "tag" | "attribute" | "script-content";
  range?: Range;
  tagName?: string;
  attrName?: string;
  attrValue?: string;
}

function analyzeHoverPosition(
  document: TextDocument,
  position: Position,
  linePrefix: string
): HoverInfo | undefined {
  // Check if we're inside a script block
  const script = getScriptBlock(document.getText());
  if (script && script.lang === "ts" && isInsideScriptBlock(document, position, script)) {
    const scriptOffset = document.offsetAt(position);
    if (scriptOffset >= script.start && scriptOffset <= script.end) {
      return {
        type: "script-content",
        range: getWordRangeAtPosition(document, position)
      };
    }
  }

  // Check if we're inside a tag name
  const tagMatch = linePrefix.match(/<([A-Za-z][\w:-]*)[^>]*$/);
  if (tagMatch && !linePrefix.includes(">")) {
    const tagStart = linePrefix.lastIndexOf("<");
    const tagEnd = linePrefix.length;
    const tagRange = new Range(
      new Position(position.line, tagStart),
      new Position(position.line, tagEnd)
    );
    return {
      type: "tag",
      range: tagRange,
      tagName: tagMatch[1]
    };
  }

  // Check if we're hovering over an attribute
  const attrMatch = linePrefix.match(/\s([\w@:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?$/);
  if (attrMatch) {
    const attrRange = getWordRangeAtPosition(document, position);
    if (attrRange) {
      return {
        type: "attribute",
        range: attrRange,
        attrName: attrMatch[1],
        attrValue: attrMatch[2] || attrMatch[3] || attrMatch[4]
      };
    }
  }

  return undefined;
}

function isInsideScriptBlock(document: TextDocument, position: Position, script: ScriptBlock): boolean {
  const offset = document.offsetAt(position);
  return offset >= script.start && offset <= script.end;
}

function getWordRangeAtPosition(document: TextDocument, position: Position): Range | undefined {
  const line = document.lineAt(position.line);
  const lineText = line.text;

  // Simple word boundary detection
  let start = position.character;
  let end = position.character;

  // Find word start
  while (start > 0 && /[\w@:-]/.test(lineText[start - 1])) {
    start--;
  }

  // Find word end
  while (end < lineText.length && /[\w@:-]/.test(lineText[end])) {
    end++;
  }

  if (start < end) {
    return new Range(
      new Position(position.line, start),
      new Position(position.line, end)
    );
  }

  return undefined;
}
