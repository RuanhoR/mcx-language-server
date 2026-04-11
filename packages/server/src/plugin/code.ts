import * as mcx from "@mbler/mcx-core";
import type { CodeMapping, IScriptSnapshot, VirtualCode } from "@volar/language-core";

interface MCXPosition {
  line: number;
  column: number;
}

interface MCXTokenLike {
  data: string;
  start: MCXPosition;
}

interface MCXTagNode {
  name: string;
  arr?: Record<string, unknown>;
  start: MCXTokenLike;
  end: MCXTokenLike | null;
  content: Array<MCXTagNode | { type: "TagContent"; data: string } | { type: "Comment"; data: string }>;
}

interface TagContentRange {
  start: number;
  end: number;
}

const FULL_FEATURES: NonNullable<CodeMapping["data"]> = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
};

const DISABLED_FEATURES: NonNullable<CodeMapping["data"]> = {
  verification: false,
  completion: false,
  semantic: false,
  navigation: false,
  structure: false,
  format: false,
};

class StringSnapshot implements IScriptSnapshot {
  constructor(private readonly text: string) {}

  public getText(start: number, end: number): string {
    return this.text.slice(start, end);
  }

  public getLength(): number {
    return this.text.length;
  }

  public getChangeRange(_oldSnapshot: IScriptSnapshot): undefined {
    return undefined;
  }
}

class EmbeddedCode implements VirtualCode {
  public readonly embeddedCodes: VirtualCode[] = [];
  public readonly snapshot: IScriptSnapshot;

  constructor(
    public readonly id: string,
    public readonly languageId: string,
    content: string,
    public readonly mappings: CodeMapping[],
  ) {
    this.snapshot = new StringSnapshot(content);
  }
}

/**
 * Root virtual code for an `.mcx` source file.
 *
 * We expose one TypeScript / JavaScript service script for language features,
 * and expose raw embedded ranges for Event/Component/UI so mappings remain complete.
 */
export class MCXVirtualCode implements VirtualCode {
  public readonly languageId = "mcx" as const;
  public readonly id = "root" as const;
  public snapshot: IScriptSnapshot;
  public mappings: CodeMapping[] = [];
  public embeddedCodes: VirtualCode[] = [];

  constructor(snapshot: IScriptSnapshot) {
    this.snapshot = snapshot;
    this.rebuild();
  }

  public update(newSnapshot: IScriptSnapshot): void {
    this.snapshot = newSnapshot;
    this.rebuild();
  }

  private rebuild(): void {
    const source = this.snapshot.getText(0, this.snapshot.getLength());
    const lineOffsets = this.computeLineOffsets(source);
    const tags = this.parseTagNodes(source);

    this.mappings = [
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [this.snapshot.getLength()],
        data: DISABLED_FEATURES,
      },
    ];

    this.embeddedCodes = [];

    const scriptTag = tags.find((tag) => tag.name === "script");
    if (scriptTag) {
      const scriptCode = this.createServiceScriptEmbedded(source, scriptTag, lineOffsets, tags);
      if (scriptCode) {
        this.embeddedCodes.push(scriptCode);
      }
    }

    const eventTag = tags.find((tag) => tag.name === "Event");
    if (eventTag) {
      const eventRaw = this.createRawEmbedded("event-raw", "mcx", source, eventTag, lineOffsets);
      if (eventRaw) {
        this.embeddedCodes.push(eventRaw);
      }
    }

    const componentTag = tags.find((tag) => tag.name === "Component");
    if (componentTag) {
      const componentRaw = this.createRawEmbedded("component-raw", "mcx", source, componentTag, lineOffsets);
      if (componentRaw) {
        this.embeddedCodes.push(componentRaw);
      }
    }

    const uiTag = tags.find((tag) => tag.name === "Ui");
    if (uiTag) {
      const uiRaw = this.createRawEmbedded("ui-raw", "mcx", source, uiTag, lineOffsets);
      if (uiRaw) {
        this.embeddedCodes.push(uiRaw);
      }
    }
  }

  private parseTagNodes(source: string): MCXTagNode[] {
    try {
      const parser = new (mcx as any).AST.tag(source);
      return parser.parseAST() as MCXTagNode[];
    } catch {
      return [];
    }
  }

  private createServiceScriptEmbedded(
    source: string,
    scriptTag: MCXTagNode,
    lineOffsets: number[],
    tags: MCXTagNode[],
  ): EmbeddedCode | null {
    const range = this.getTagContentRange(source, scriptTag, lineOffsets);
    if (!range) {
      return null;
    }

    const scriptSource = source.slice(range.start, range.end);
    const scriptLang = (scriptTag.arr?.lang ?? "").toString().toLowerCase();
    const isTypeScript = scriptLang === "ts" || scriptLang === "typescript";

    const analysisSection = this.buildMetadataSection(tags);
    const generated = scriptSource + analysisSection;

    const mappings: CodeMapping[] = [];
    if (scriptSource.length > 0) {
      mappings.push({
        sourceOffsets: [range.start],
        generatedOffsets: [0],
        lengths: [scriptSource.length],
        data: FULL_FEATURES,
      });
    }

    return new EmbeddedCode(
      "script",
      isTypeScript ? "typescript" : "javascript",
      generated,
      mappings,
    );
  }

  private createRawEmbedded(
    id: string,
    languageId: string,
    source: string,
    tag: MCXTagNode,
    lineOffsets: number[],
  ): EmbeddedCode | null {
    const range = this.getTagContentRange(source, tag, lineOffsets);
    if (!range) {
      return null;
    }

    const content = source.slice(range.start, range.end);

    return new EmbeddedCode(id, languageId, content, [
      {
        sourceOffsets: [range.start],
        generatedOffsets: [0],
        lengths: [content.length],
        data: DISABLED_FEATURES,
      },
    ]);
  }

  private buildMetadataSection(tags: MCXTagNode[]): string {
    const chunks: string[] = [];

    const eventTag = tags.find((tag) => tag.name === "Event");
    if (eventTag) {
      const raw = this.firstTextChild(eventTag)?.trim();
      if (raw) {
        chunks.push(`\n/* MCX Event block */`);
        chunks.push(`const __mcx_event_raw = ${JSON.stringify(raw)};`);
        chunks.push("void __mcx_event_raw;");
      }
    }

    const componentTag = tags.find((tag) => tag.name === "Component");
    if (componentTag) {
      const refs = this.collectComponentReferences(componentTag);
      if (refs.length > 0) {
        chunks.push(`\n/* MCX Component export references */`);
        for (const ref of refs) {
          chunks.push(`void (${ref});`);
        }
      }
    }

    const uiTag = tags.find((tag) => tag.name === "Ui");
    if (uiTag) {
      const hasUiBody = this.firstTextChild(uiTag)?.trim();
      if (hasUiBody) {
        chunks.push(`\n/* MCX Ui block exists */`);
        chunks.push("const __mcx_has_ui_block = true;");
        chunks.push("void __mcx_has_ui_block;");
      }
    }

    if (chunks.length === 0) {
      return "";
    }

    return "\n" + chunks.join("\n") + "\n";
  }

  private firstTextChild(tag: MCXTagNode): string | undefined {
    for (const child of tag.content) {
      if ((child as { type?: string }).type === "TagContent") {
        return (child as { data: string }).data;
      }
    }
    return undefined;
  }

  private collectComponentReferences(componentTag: MCXTagNode): string[] {
    const refs: string[] = [];

    for (const parent of componentTag.content) {
      if (!this.isTagNode(parent)) {
        continue;
      }

      for (const item of parent.content) {
        if (!this.isTagNode(item)) {
          continue;
        }

        const ref = this.firstTextChild(item)?.trim();
        if (!ref) {
          continue;
        }

        // Keep reference lines syntax-safe to avoid polluting diagnostics.
        if (this.isSafeReferenceExpression(ref)) {
          refs.push(ref);
        }
      }
    }

    return refs;
  }

  private isSafeReferenceExpression(value: string): boolean {
    return /^[$_A-Za-z][$_A-Za-z0-9]*(?:\.[$_A-Za-z][$_A-Za-z0-9]*)*$/.test(value);
  }

  private isTagNode(node: unknown): node is MCXTagNode {
    return !!node && typeof node === "object" && "name" in (node as object) && "start" in (node as object);
  }

  private getTagContentRange(source: string, tag: MCXTagNode, lineOffsets: number[]): TagContentRange | null {
    if (!tag.start || !tag.start.start) {
      return null;
    }

    const startOffset = this.offsetAt(lineOffsets, tag.start.start);
    const startTagEnd = Math.min(source.length, startOffset + (tag.start.data?.length ?? 0));

    let endTagStart = startTagEnd;
    if (tag.end?.start) {
      endTagStart = this.offsetAt(lineOffsets, tag.end.start);
    }

    if (endTagStart < startTagEnd) {
      endTagStart = startTagEnd;
    }

    return {
      start: startTagEnd,
      end: Math.min(source.length, endTagStart),
    };
  }

  private computeLineOffsets(text: string): number[] {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  private offsetAt(lineOffsets: number[], position: MCXPosition): number {
    const lineIndex = Math.max(0, Math.min(lineOffsets.length - 1, position.line - 1));
    return lineOffsets[lineIndex] + Math.max(0, position.column);
  }
}
