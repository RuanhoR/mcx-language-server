import type { McxCompletionContribution, McxCompletionManifest } from './types.js';

/** Workspace-relative path of the manifest mbler writes during a build. */
export const MCX_COMPLETION_MANIFEST = '.mbler/mcx-completion.json';

/** Parse a manifest, ignoring entries that do not look like contributions. */
export function parseCompletionManifest(raw: string): McxCompletionManifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `[mcx completion] ${MCX_COMPLETION_MANIFEST} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!data || typeof data !== 'object') {
    throw new Error(
      `[mcx completion] ${MCX_COMPLETION_MANIFEST} must contain an object`,
    );
  }
  const record = data as { version?: unknown; project?: unknown; contributions?: unknown };
  const contributions = Array.isArray(record.contributions)
    ? record.contributions.filter(isContribution)
    : [];
  return {
    version: 1,
    ...(typeof record.project === 'string' ? { project: record.project } : {}),
    contributions,
  };
}

/** Serialise contributions for mbler to write. */
export function serializeCompletionManifest(
  contributions: McxCompletionContribution[],
  project?: string,
): string {
  const manifest: McxCompletionManifest = {
    version: 1,
    ...(project ? { project } : {}),
    contributions,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Read a manifest from disk. `readFile` is injected so this stays usable from
 * both the server (node fs) and editor bundles.
 */
export function readCompletionManifest(
  filePath: string,
  readFile: (path: string) => string | undefined,
): McxCompletionManifest | undefined {
  const raw = readFile(filePath);
  if (raw === undefined) return undefined;
  return parseCompletionManifest(raw);
}

function isContribution(value: unknown): value is McxCompletionContribution {
  if (!value || typeof value !== 'object') return false;
  const record = value as { name?: unknown };
  return typeof record.name === 'string' && record.name.length > 0;
}
