/**
 * Unit tests — pro-zero-credit-calculator (Group A: 12 tests)
 *
 * Spec: spec/22-app-issues/114-pro-zero-credit-balance-calculation.md §6 Group A
 *
 * All IDs/emails sanitized: ws-001, owner-uid-001, owner@sample.com.
 */

import { describe, it, expect } from 'vitest';
import {
    calculateProZeroCreditSummary,
    sumGrantTypeRemaining,
    sumExpiringSoon,
} from '../pro-zero/pro-zero-credit-calculator';
import { CreditGrantType } from '../pro-zero/credit-grant-type';
import { MacroCreditSource } from '../pro-zero/macro-credit-source';
import type { CreditBalanceResponseTyped } from '../pro-zero/credit-balance-response-typed';

const NOW_MS = Date.parse('2026-05-25T00:00:00Z');
const DAY_MS = 86_400_000;

function referencePayload(): CreditBalanceResponseTyped {
    return {
        ledger_enabled: false,
        total_remaining: 76,
        total_granted: 205,
        daily_remaining: 5,
        daily_limit: 5,
        total_billing_period_used: 144,
        expiring_grants: [
            {
                grant_type: CreditGrantType.BILLING,
                credits: 71,
                expires_at: '2026-07-07T08:00:00Z',
            },
        ],
        grant_type_balances: [
            { grant_type: CreditGrantType.DAILY, granted: 5, remaining: 5 },
            { grant_type: CreditGrantType.BILLING, granted: 200, remaining: 71 },
        ],
    };
}

describe('calculateProZeroCreditSummary — reference payload (Group A)', () => {
    it('A1: Total equals total_granted (205)', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).Total).toBe(205);
    });

    it('A2: AvailableCredits equals total_remaining (76)', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).AvailableCredits).toBe(76);
    });

    it('A3: TotalUsed equals total_billing_period_used (144)', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).TotalUsed).toBe(144);
    });

    it('A4: DailyRemaining equals daily_remaining (5)', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).DailyRemaining).toBe(5);
    });

    it('A5: DailyLimit equals daily_limit (5)', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).DailyLimit).toBe(5);
    });

    it('A6: BillingRemaining equals grant_type_balances[billing].remaining (71)', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).BillingRemaining).toBe(71);
    });

    it('A7: TopupRemaining returns 0 when no topup grant present', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).TopupRemaining).toBe(0);
    });

    it('A8: BonusRemaining returns 0 when no bonus grant present', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).BonusRemaining).toBe(0);
    });

    it('A9: RolloverRemaining returns 0 when no rollover grant present', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).RolloverRemaining).toBe(0);
    });

    it('A10: LedgerEnabled mirrors ledger_enabled (false→false, true→true)', () => {
        const offResult = calculateProZeroCreditSummary(referencePayload(), NOW_MS);
        expect(offResult.LedgerEnabled).toBe(false);

        const on = referencePayload();
        on.ledger_enabled = true;
        expect(calculateProZeroCreditSummary(on, NOW_MS).LedgerEnabled).toBe(true);
    });

    it('A11: Source is always MacroCreditSource.CREDIT_BALANCE', () => {
        expect(calculateProZeroCreditSummary(referencePayload(), NOW_MS).Source).toBe(
            MacroCreditSource.CREDIT_BALANCE,
        );
    });

    it('A12: ExpiringSoonCredits sums credits whose expires_at ≤ now+14d', () => {
        const payload = referencePayload();
        payload.expiring_grants = [
            { grant_type: CreditGrantType.BILLING, credits: 30, expires_at: new Date(NOW_MS + 7 * DAY_MS).toISOString() },
            { grant_type: CreditGrantType.BILLING, credits: 40, expires_at: new Date(NOW_MS + 60 * DAY_MS).toISOString() },
            { grant_type: CreditGrantType.TOPUP, credits: 10, expires_at: new Date(NOW_MS + 14 * DAY_MS).toISOString() },
        ];
        expect(calculateProZeroCreditSummary(payload, NOW_MS).ExpiringSoonCredits).toBe(40);
    });
});

describe('sumGrantTypeRemaining + sumExpiringSoon — helpers (Group E partial)', () => {
    it('sumGrantTypeRemaining returns 0 for empty array', () => {
        const empty: CreditBalanceResponseTyped = { ...referencePayload(), grant_type_balances: [] };
        expect(sumGrantTypeRemaining(empty, CreditGrantType.BILLING)).toBe(0);
    });

    it('sumExpiringSoon returns 0 when expiring_grants is empty', () => {
        const empty: CreditBalanceResponseTyped = { ...referencePayload(), expiring_grants: [] };
        expect(sumExpiringSoon(empty, NOW_MS)).toBe(0);
    });
});
