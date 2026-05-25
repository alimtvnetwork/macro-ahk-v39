/**
 * MacroCreditSummary — controller output of the credit-resolution flow.
 *
 * Spec: spec/22-app-issues/110-macro-controller-pro-zero-credit-balance.md §6.6
 * Spec: spec/22-app-issues/114-pro-zero-credit-balance-calculation.md §4
 */

import type { MacroCreditSource } from './macro-credit-source';

export interface MacroCreditSummary {
    Total: number;
    AvailableCredits: number;
    TotalUsed: number;
    Source: MacroCreditSource;
    DailyRemaining: number;
    DailyLimit: number;
    BillingRemaining: number;
    TopupRemaining: number;
    BonusRemaining: number;
    RolloverRemaining: number;
    ExpiringSoonCredits: number;
    LedgerEnabled: boolean;
}
