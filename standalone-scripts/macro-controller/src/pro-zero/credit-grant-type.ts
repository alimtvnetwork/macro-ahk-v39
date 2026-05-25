/**
 * CreditGrantType — wire values from credit-balance grants/balances.
 *
 * Spec: spec/22-app-issues/110-macro-controller-pro-zero-credit-balance.md §4.2
 * Spec: spec/22-app-issues/114-pro-zero-credit-balance-calculation.md §3
 */

export enum CreditGrantType {
    DAILY = 'daily',
    BILLING = 'billing',
    GRANTED = 'granted',
    TOPUP = 'topup',
    BONUS = 'bonus',
    ROLLOVER = 'rollover',
}
