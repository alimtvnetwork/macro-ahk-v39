/**
 * Remix Name Resolver — v2.217.0
 *
 * Pure logic for "Remix Next" automation. Given a current project name,
 * compute the next available `*-V{n}` name (or the configured separator)
 * after pre-checking for collisions in the workspace.
 *
 * Resolver rules (per user choice "Match input casing"):
 *   - "Foo"    → "Foo-V2"
 *   - "Foo-V2" → "Foo-V3"
 *   - "foo-v2" → "foo-v3"   (lowercase preserved)
 *   - "Foo-V9" → "Foo-V10"
 *
 * Separator and "v" letter casing are derived from the input. When no V
 * suffix exists the separator from `RemixConfig.nextSuffixSeparator` and
 * an UPPERCASE V are used (matches the spec's default style).
 *
 * Collision handling: `resolveNextName` accepts an `existingNames` set and
 * keeps incrementing until unique, up to `maxCollisionIncrements`.
 */

/** Parsed shape of a name like `foo-V12`. */
interface ParsedName {
  base: string;
  /** Separator literal preceding `V{n}`, e.g. '-' or ''. Empty when no suffix. */
  separator: string;
  /** The literal V/v letter found, preserving input casing. Empty when no suffix. */
  vLetter: string;
  /** Current numeric suffix; 1 when no V suffix is present. */
  current: number;
}

const SUFFIX_REGEX = /^(.*?)([-_ ]?)([Vv])(\d+)$/;

/** Parse a project name into base + V-suffix components. Casing-preserving. */
export function parseName(name: string): ParsedName {
  const trimmed = name.trim();
  const match = SUFFIX_REGEX.exec(trimmed);
  if (!match) {
    return { base: trimmed, separator: '', vLetter: '', current: 1 };
  }
  const [, base, separator, vLetter, numStr] = match;
  const num = Number(numStr);
  return {
    base,
    separator,
    vLetter,
    current: Number.isFinite(num) && num > 0 ? num : 1,
  };
}

/** Build a name from parsed parts at a given numeric version. */
export function buildName(
  parsed: ParsedName,
  n: number,
  fallbackSeparator: string,
  vCasing: 'preserve' | 'upper' | 'lower' = 'preserve',
): string {
  const sep = parsed.vLetter ? parsed.separator : fallbackSeparator;
  const inputV = parsed.vLetter || 'V';
  const v = vCasing === 'upper' ? 'V' : vCasing === 'lower' ? 'v' : inputV;
  return parsed.base + sep + v + String(n);
}

/**
 * Resolve the next unique remix name.
 *
 * @param currentName   the project being remixed
 * @param existingNames lowercase set of names already in the workspace
 * @param config        injected so callers can override separator and V casing
 * @returns the resolved name and the number of collision-increments performed
 *
 * Throws when `maxCollisionIncrements` is exceeded so the UI can surface
 * a clear error instead of silently picking an unexpected name.
 */
export function resolveNextName(
  currentName: string,
  existingNames: Set<string>,
  config: {
    nextSuffixSeparator: string;
    maxCollisionIncrements: number;
    nextVCasing?: 'preserve' | 'upper' | 'lower';
  },
): { name: string; collisionsResolved: number } {
  if (!currentName || !currentName.trim()) {
    throw new Error('resolveNextName: currentName is empty');
  }
  const parsed = parseName(currentName);
  const casing = config.nextVCasing || 'preserve';
  // Start at current+1 so "Foo-V2" → "Foo-V3", "Foo" (current=1) → "Foo-V2".
  let candidateNum = parsed.current + 1;
  let collisions = 0;
  let candidate = buildName(parsed, candidateNum, config.nextSuffixSeparator, casing);

  while (existingNames.has(candidate.toLowerCase())) {
    candidateNum += 1;
    collisions += 1;
    if (collisions > config.maxCollisionIncrements) {
      throw new Error(
        'resolveNextName: exceeded ' + config.maxCollisionIncrements
          + ' collision increments starting from ' + currentName,
      );
    }
    candidate = buildName(parsed, candidateNum, config.nextSuffixSeparator, casing);
  }

  return { name: candidate, collisionsResolved: collisions };
}
