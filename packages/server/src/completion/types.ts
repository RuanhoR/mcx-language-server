/**
 * Portable completion data model for MCX templates.
 *
 * Nothing in this module (or its siblings) touches an editor API: the language
 * server, the VS Code extension and compiler plugins all share the same plain
 * objects, so a plugin can describe its tags once and have every consumer pick
 * the data up.
 */

/** A single attribute offered inside an open tag. */
export interface McxAttributeCompletion {
  /** attribute name as written in the template, e.g. `@after` or `:value` */
  name: string
  /** short description shown next to the entry */
  detail?: string
  /** snippet inserted instead of the bare name, e.g. `lang="ts"` */
  insertText?: string
  /** enum values offered while completing the attribute value */
  values?: string[]
  /** markdown documentation, when the consumer supports it */
  documentation?: string
}

/** A tag and everything that should be suggested around it. */
export interface McxTagCompletion {
  name: string
  /** one-line description used as the completion detail */
  detail?: string
  /** tags suggested directly inside this tag */
  children?: string[]
  /** attributes suggested on this tag (inherited sets are merged in) */
  attributes?: McxAttributeCompletion[]
  /**
   * Other tags whose attribute sets are inherited, e.g.
   * `extends: ['ui-control']` for a control that behaves like the built-ins.
   */
  extends?: string[]
  /**
   * Container tags keep "child of" context on the following line while a leaf
   * tag's completions fall back to its parent.
   */
  container?: boolean
  /** snippet used when completing the tag name; `$0` marks the cursor */
  snippet?: string
  /** markdown documentation for hover/complete detail */
  documentation?: string
}

/**
 * A contribution is one unit of completion data. Plugins export one so the
 * build can collect them into `.mbler/mcx-completion.json`, and the language
 * server treats the built-in DSL data as just another contribution.
 */
export interface McxCompletionContribution {
  /** contributor id — plugin package name, or `mcx` for the built-ins */
  name: string
  /** tags offered when the file has no enclosing tag */
  rootTags?: string[]
  tags?: McxTagCompletion[]
  /** shared attribute sets referenced through `McxTagCompletion.extends` */
  attributeSets?: Record<string, McxAttributeCompletion[]>
  /** values offered for `<script lang="...">` */
  scriptLangs?: string[]
}

/** Shape written to `.mbler/mcx-completion.json` by mbler. */
export interface McxCompletionManifest {
  version: 1
  /** absolute or workspace-relative project root, informational only */
  project?: string
  contributions: McxCompletionContribution[]
}
