import * as mcx from "@mbler/mcx-core";
import {
  Position,
  Range,
  TextEdit,
  type FormattingOptions,
  type TextDocument,
} from "vscode";

interface MCXTagContentNode {
  type: "TagContent";
  data: string;
}

interface MCXCommentNode {
  type: "Comment";
  data: string;
}

interface MCXTagNode {
  type: "TagNode";
  name: string;
  arr: Record<string, string | boolean>;
  content: Array<MCXTagNode | MCXTagContentNode | MCXCommentNode>;
  end: unknown | null;
}

/**
 * Format MCX text by rebuilding output from parsed AST nodes.
 * This keeps structural formatting deterministic and stable.
 */
export function formatMCXDocument(
  document: TextDocument,
  options: FormattingOptions,
): TextEdit[] {
  const source = document.getText();
  const formatted = formatMCXText(source, options);
  if (formatted === source) {
    return [];
  }

  const end = document.positionAt(source.length);
  return [TextEdit.replace(new Range(new Position(0, 0), end), formatted)];
}

export function formatMCXText(source: string, options: FormattingOptions): string {
  const indentUnit = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
  const ast = parseWithComments(source);
  if (!ast) {
    return source;
  }

  const blocks: string[] = [];
  for (const node of ast) {
    blocks.push(printTagNode(node, indentUnit, 0));
  }
  return blocks.join("\n\n").trimEnd() + "\n";
}

function parseWithComments(source: string): MCXTagNode[] | null {
  try {
    const parser = new (mcx as any).AST.tag(source, true);
    return parser.parseAST() as MCXTagNode[];
  } catch {
    return null;
  }
}

function printTagNode(node: MCXTagNode, indentUnit: string, depth: number): string {
  const indent = indentUnit.repeat(depth);
  const attrs = printAttributes(node.arr);
  const openTag = attrs ? `<${node.name} ${attrs}>` : `<${node.name}>`;

  const normalizedChildren = node.content.filter((item) => {
    if ((item as MCXTagContentNode).type === "TagContent") {
      return (item as MCXTagContentNode).data.trim().length > 0;
    }
    return true;
  });

  if (normalizedChildren.length === 0) {
    if (!node.end) {
      return `${indent}${openTag.slice(0, -1)} />`;
    }
    return `${indent}${openTag}</${node.name}>`;
  }

  // Keep script content readable and avoid rewriting its internal token spacing.
  if (
    node.name === "script" &&
    normalizedChildren.length === 1 &&
    (normalizedChildren[0] as MCXTagContentNode).type === "TagContent"
  ) {
    const raw = (normalizedChildren[0] as MCXTagContentNode).data;
    const scriptBody = indentMultiline(normalizeMultilineText(raw), indentUnit.repeat(depth + 1));
    return `${indent}${openTag}\n${scriptBody}\n${indent}</${node.name}>`;
  }

  const lines: string[] = [`${indent}${openTag}`];
  for (const child of normalizedChildren) {
    lines.push(printNode(child, indentUnit, depth + 1));
  }
  lines.push(`${indent}</${node.name}>`);
  return lines.join("\n");
}

function printNode(
  node: MCXTagNode | MCXTagContentNode | MCXCommentNode,
  indentUnit: string,
  depth: number,
): string {
  if ((node as MCXTagNode).type === "TagNode") {
    return printTagNode(node as MCXTagNode, indentUnit, depth);
  }

  const indent = indentUnit.repeat(depth);

  if ((node as MCXCommentNode).type === "Comment") {
    return indentMultiline((node as MCXCommentNode).data.trim(), indent);
  }

  const text = normalizeMultilineText((node as MCXTagContentNode).data);
  return indentMultiline(text, indent);
}

function printAttributes(attributes: Record<string, string | boolean>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === true || value === "true") {
      parts.push(key);
      continue;
    }

    const escaped = String(value).replace(/"/g, "&quot;");
    parts.push(`${key}="${escaped}"`);
  }
  return parts.join(" ");
}

function normalizeMultilineText(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");

  while (lines.length > 0 && lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }

  const meaningful = lines.filter((line) => line.trim().length > 0);
  if (meaningful.length === 0) {
    return "";
  }

  const minIndent = meaningful.reduce((min, line) => {
    const leading = line.match(/^\s*/)?.[0].length ?? 0;
    return Math.min(min, leading);
  }, Infinity);

  return lines.map((line) => line.slice(minIndent)).join("\n");
}

function indentMultiline(text: string, indent: string): string {
  if (!text) {
    return indent;
  }
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}
