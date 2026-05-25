/**
 * pro-zero-credit-calculator — pure function mapping CreditBalanceResponseTyped
 * to MacroCreditSummary. No I/O, no globals, no side effects.
 *
 * Spec: spec/22-app-issues/114-pro-zero-credit-balance-calculation.md §4, §5 Step 1
 *
 * STRICT: For pro_0 plan, Total/Available/TotalUsed come ONLY from the
 * /credit-balance response — never from workspace *_limit fields.
 */

import { CreditGrantType } from './credit-grant-type';
import { MacroCreditSource } from './macro-credit-source';
import type { CreditBalanceResponseTyped } from './credit-balance-response-typed';
import type { ExpiringGrant } from './expiring-grant';
import type { MacroCreditSummary } from './macro-credit-summary';

const EXPIRING_SOON_WINDOW_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export function sumGrantTypeRemaining(
    balance: CreditBalanceResponseTyped,
    grantType: CreditGrantType,
): number {
    const list = balance.grant_type_balances;
    if (!Array.isArray(list) || list.length === 0) return 0;

    return list
        .filter((g) => g.grant_type === grantType)
        .reduce((acc, g) => acc + (Number.isFinite(g.remaining) ? g.remaining : 0), 0);
}

function isWithinWindow(grant: ExpiringGrant, nowMs: number, windowDays: number): boolean {
    const expiresMs = Date.parse(grant.expires_at);
    if (!Number.isFinite(expiresMs)) return false;

    return expiresMs <= nowMs + windowDays * MS_PER_DAY;
}

export function sumExpiringSoon(
    balance: CreditBalanceResponseTyped,
    nowMs: number,
    windowDays: number = EXPIRING_SOON_WINDOW_DAYS,
): number {
    const list = balance.expiring_grants;
    if (!Array.isArray(list) || list.length === 0) return 0;

    return list
        .filter((g) => isWithinWindow(g, nowMs, windowDays))
        .reduce((acc, g) => acc + (Number.isFinite(g.credits) ? g.credits : 0), 0);
}

export function calculateProZeroCreditSummary(
    balance: CreditBalanceResponseTyped,
    nowMs: number = Date.now(),
): MacroCreditSummary {
    return {
        Total: balance.total_granted,
        AvailableCredits: balance.total_remaining,
        TotalUsed: balance.total_billing_period_used,
        Source: MacroCreditSource.CREDIT_BALANCE,
        DailyRemaining: balance.daily_remaining,
        DailyLimit: balance.daily_limit,
        BillingRemaining: sumGrantTypeRemaining(balance, CreditGrantType.BILLING),
        TopupRemaining: sumGrantTypeRemaining(balance, CreditGrantType.TOPUP),
        BonusRemaining: sumGrantTypeRemaining(balance, CreditGrantType.BONUS),
        RolloverRemaining: sumGrantTypeRemaining(balance, CreditGrantType.ROLLOVER),
        ExpiringSoonCredits: sumExpiringSoon(balance, nowMs),
        LedgerEnabled: balance.ledger_enabled,
    };
}
