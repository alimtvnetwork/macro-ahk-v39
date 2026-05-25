/**
 * E2E harness — feeds /credit-balance JSON fixtures through the pure
 * calculator and asserts MacroCreditSummary output. No Chrome required.
 *
 * Spec: spec/22-app-issues/114-pro-zero-credit-balance-calculation.md §5 Step 4
 *
 * All IDs/emails in fixtures are anonymized (ws-00N, owner@sample.com).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateProZeroCreditSummary } from '../../../src/pro-zero/pro-zero-credit-calculator';
import type { CreditBalanceResponseTyped } from '../../../src/pro-zero/credit-balance-response-typed';
import type { MacroCreditSummary } from '../../../src/pro-zero/macro-credit-summary';

interface Fixture {
    name: string;
    description: string;
    nowIso?: string;
    workspace: { id: string; plan: string; owner_email?: string };
    input: CreditBalanceResponseTyped;
    expected: Partial<MacroCreditSummary>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, 'fixtures');

function loadFixtures(): Fixture[] {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();

    return files.map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as Fixture);
}

const FIXTURES = loadFixtures();

describe('Group D — credit-balance E2E (6 fixtures)', () => {
    it('loads all 6 fixtures from disk', () => {
        expect(FIXTURES).toHaveLength(6);
    });

    for (const fx of FIXTURES) {
        it('E2E: ' + fx.name + ' — ' + fx.description, () => {
            const nowMs = fx.nowIso ? Date.parse(fx.nowIso) : 0;
            const actual = calculateProZeroCreditSummary(fx.input, nowMs);
            for (const key of Object.keys(fx.expected) as Array<keyof MacroCreditSummary>) {
                expect({ key, value: actual[key] }).toEqual({ key, value: fx.expected[key] });
            }
        });
    }

    it('bonus-and-billing: BonusRemaining + BillingRemaining ≤ AvailableCredits', () => {
        const fx = FIXTURES.find((f) => f.name === 'bonus-and-billing');
        expect(fx).toBeDefined();
        const out = calculateProZeroCreditSummary(fx!.input, 0);
        expect(out.BonusRemaining + out.BillingRemaining).toBeLessThanOrEqual(out.AvailableCredits);
    });

    it('all fixtures use sanitized IDs (no real workspace_01* or @lovable.dev)', () => {
        for (const fx of FIXTURES) {
            expect(fx.workspace.id).toMatch(/^ws-\d{3}$/);
            const email = fx.workspace.owner_email || '';
            expect(email === '' || email.endsWith('@sample.com')).toBe(true);
            expect(fx.workspace.id).not.toMatch(/workspace_01/);
        }
    });
});
