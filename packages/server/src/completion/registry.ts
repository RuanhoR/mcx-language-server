import { builtinCompletionContribution } from './builtin.js';
import type {
  McxAttributeCompletion,
  McxCompletionContribution,
  McxTagCompletion,
} from './types.js';

/** A tag with `extends` resolved and contributors merged. */
export interface ResolvedMcxTag {
  name: string
  detail?: string
  children: string[]
  attributes: McxAttributeCompletion[]
  container: boolean
  snippet?: string
  documentation?: string
}

export interface McxCompletionRegistry {
  /** top-level tags, in contribution order */
  rootTags(): string[]
  /** `<script lang="...">` values */
  scriptLangs(): string[]
  /** every known tag, resolved */
  tags(): ResolvedMcxTag[]
  tag(name: string): ResolvedMcxTag | undefined
  /** child tags of `parent`, `undefined` when the parent is unknown */
  childrenOf(parent: string): string[] | undefined
  /** resolved attributes of `tag` */
  attributesOf(tag: string): McxAttributeCompletion[]
  /** tags that keep child-context on the following line */
  containerTags(): Set<string>
  /** contributions in merge order, for debugging/diagnostics */
  contributions(): McxCompletionContribution[]
  /** a new registry with extra contributions merged on top */
  withContributions(extra: McxCompletionContribution[]): McxCompletionRegistry
}

interface MergedTag extends McxTagCompletion {
  extends: string[]
}

function mergeAttributes(
  base: McxAttributeCompletion[],
  extra: McxAttributeCompletion[],
): McxAttributeCompletion[] {
  const merged = [...base];
  for (const attribute of extra) {
    const index = merged.findIndex(item => item.name === attribute.name);
    if (index === -1) merged.push(attribute);
    else merged[index] = { ...merged[index], ...attribute };
  }
  return merged;
}

function mergeTags(target: Map<string, MergedTag>, tag: McxTagCompletion): void {
  const existing = target.get(tag.name);
  if (!existing) {
    target.set(tag.name, {
      ...tag,
      extends: tag.extends ? [...tag.extends] : [],
    });
    return;
  }
  const next: MergedTag = {
    ...existing,
    ...tag,
    children: tag.children ?? existing.children,
    attributes: mergeAttributes(existing.attributes ?? [], tag.attributes ?? []),
    extends: [...existing.extends, ...(tag.extends ?? [])],
    container: tag.container ?? existing.container,
  };
  target.set(tag.name, next);
}

/** Merge contributions left-to-right; later entries win per field. */
export function mergeCompletionContributions(
  contributions: McxCompletionContribution[],
): {
  rootTags: string[]
  scriptLangs: string[]
  tags: Map<string, MergedTag>
  attributeSets: Record<string, McxAttributeCompletion[]>
} {
  const rootTags: string[] = [];
  const scriptLangs: string[] = [];
  const tags = new Map<string, MergedTag>();
  const attributeSets: Record<string, McxAttributeCompletion[]> = {};

  for (const contribution of contributions) {
    for (const name of contribution.rootTags ?? []) {
      if (!rootTags.includes(name)) rootTags.push(name);
    }
    for (const lang of contribution.scriptLangs ?? []) {
      if (!scriptLangs.includes(lang)) scriptLangs.push(lang);
    }
    for (const [key, attrs] of Object.entries(contribution.attributeSets ?? {})) {
      attributeSets[key] = mergeAttributes(attributeSets[key] ?? [], attrs);
    }
    for (const tag of contribution.tags ?? []) mergeTags(tags, tag);
  }

  return { rootTags, scriptLangs, tags, attributeSets };
}

/**
 * Build a registry. The built-in MCX DSL data is always present unless the
 * caller supplies a contribution named `mcx`.
 */
export function createMcxCompletionRegistry(
  ...contributions: McxCompletionContribution[]
): McxCompletionRegistry {
  const list: McxCompletionContribution[] = contributions.some(
    item => item.name === 'mcx',
  )
    ? [...contributions]
    : [builtinCompletionContribution, ...contributions];

  const merged = mergeCompletionContributions(list);

  const resolveAttributes = (
    tag: MergedTag,
    stack: Set<string> = new Set(),
  ): McxAttributeCompletion[] => {
    let attributes: McxAttributeCompletion[] = [];
    const seenSets = new Set<string>();
    for (const name of tag.extends) {
      // `extends` may point at a shared attribute set or at another tag.
      const set = merged.attributeSets[name];
      if (set && !seenSets.has(name)) {
        seenSets.add(name);
        attributes = mergeAttributes(attributes, set);
        continue;
      }
      const parent = merged.tags.get(name);
      // Cycle guard: `a extends b` + `b extends a` must not recurse forever.
      if (parent && !stack.has(name)) {
        attributes = mergeAttributes(
          attributes,
          resolveAttributes(parent, new Set([...stack, tag.name])),
        );
      }
    }
    return mergeAttributes(attributes, tag.attributes ?? []);
  };

  const cache = new Map<string, ResolvedMcxTag>();
  const resolveTag = (tag: MergedTag): ResolvedMcxTag => {
    const cached = cache.get(tag.name);
    if (cached) return cached;
    // Guard against `a extends b, b extends a` by caching a placeholder first.
    const placeholder: ResolvedMcxTag = {
      name: tag.name,
      children: tag.children ?? [],
      attributes: [],
      container: tag.container ?? false,
    };
    cache.set(tag.name, placeholder);
    const resolved: ResolvedMcxTag = {
      ...placeholder,
      ...(tag.detail !== undefined ? { detail: tag.detail } : {}),
      ...(tag.snippet !== undefined ? { snippet: tag.snippet } : {}),
      ...(tag.documentation !== undefined
        ? { documentation: tag.documentation }
        : {}),
      attributes: resolveAttributes(tag),
    };
    cache.set(tag.name, resolved);
    return resolved;
  };

  const registry: McxCompletionRegistry = {
    rootTags: () => [...merged.rootTags],
    scriptLangs: () => [...merged.scriptLangs],
    tags: () => [...merged.tags.values()].map(resolveTag),
    tag: name => {
      const tag = merged.tags.get(name);
      return tag ? resolveTag(tag) : undefined;
    },
    childrenOf: name => {
      const tag = merged.tags.get(name);
      if (!tag) return undefined;
      return [...(tag.children ?? [])];
    },
    attributesOf: name => {
      const tag = merged.tags.get(name);
      return tag ? resolveTag(tag).attributes : [];
    },
    containerTags: () => {
      const set = new Set<string>();
      for (const tag of merged.tags.values()) {
        if (tag.container) set.add(tag.name);
      }
      return set;
    },
    contributions: () => list.map(item => ({ ...item })),
    withContributions: extra =>
      createMcxCompletionRegistry(...list, ...extra),
  };

  return registry;
}
