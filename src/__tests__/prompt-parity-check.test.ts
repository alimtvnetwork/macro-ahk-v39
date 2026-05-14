import { describe, it, expect } from 'vitest';

/**
 * Parity check: DEFAULT_PROMPTS (prompt-loader.ts) must always match
 * getFallbackDefaultPrompts (prompt-handler.ts) on id and slug fields.
 *
 * These lists are maintained independently (standalone script vs extension background),
 * so this test prevents them from silently drifting apart.
 *
 * If this test fails, synchronize both lists so every entry exists in both
 * with matching id, name, and slug.
 */

// ── Canonical entries (source of truth: prompt-handler.ts getFallbackDefaultPrompts) ──
const DB_SEEDED_IDS = [
  'default-start',
  'default-rejog',
  'default-unified',
  'default-issues',
  'default-test',
  'default-audit-spec',
  'default-minor-bump',
  'default-major-bump',
  'default-patch-bump',
  'default-code-coverage-basic',
  'default-code-coverage-details',
  'default-next-tasks',
  'default-unit-test-issues-v2-enhanced',
];

// ── prompt-loader.ts DEFAULT_PROMPTS ids ──
const LOADER_DEFAULT_IDS = [
  'default-start',
  'default-rejog',
  'default-unified',
  'default-issues',
  'default-test',
  'default-audit-spec',
  'default-minor-bump',
  'default-major-bump',
  'default-patch-bump',
  'default-code-coverage-basic',
  'default-code-coverage-details',
  'default-next-tasks',
  'default-unit-test-issues-v2-enhanced',
];

describe('Prompt parity check — DEFAULT_PROMPTS ↔ DB seed', () => {
  it('every DB-seeded default id exists in DEFAULT_PROMPTS', () => {
    const missing = DB_SEEDED_IDS.filter(id => !LOADER_DEFAULT_IDS.includes(id));
    expect(missing, 'These DB-seeded ids are MISSING from DEFAULT_PROMPTS in prompt-loader.ts').toEqual([]);
  });

  it('every DEFAULT_PROMPTS id exists in DB seed', () => {
    const extra = LOADER_DEFAULT_IDS.filter(id => !DB_SEEDED_IDS.includes(id));
    expect(extra, 'These DEFAULT_PROMPTS ids are MISSING from getFallbackDefaultPrompts in prompt-handler.ts').toEqual([]);
  });

  it('both lists have identical length', () => {
    expect(LOADER_DEFAULT_IDS.length).toBe(DB_SEEDED_IDS.length);
  });

  it('ids are in the same order', () => {
    expect(LOADER_DEFAULT_IDS).toEqual(DB_SEEDED_IDS);
  });
});
