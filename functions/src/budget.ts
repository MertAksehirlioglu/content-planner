/** Pure budget arithmetic. No SDK, so node --test runs it. The Firestore layer reserves spend
 *  transactionally before a call and settles the actual cost afterwards. */

export const DEFAULT_MONTHLY_USD = 5;

export interface BudgetDoc { monthlyUsd?: number }

export function resolveMonthlyUsd(doc: BudgetDoc | undefined): number {
  const v = doc?.monthlyUsd;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_MONTHLY_USD;
}

export function isOverBudget(monthlyUsd: number, spentUsd: number): boolean {
  return spentUsd >= monthlyUsd;
}

// Firestore stores IEEE-754 numbers, so ten $0.10 increments can read back as
// 0.9999999999999999. A nanodollar tolerance is far below anything Gemini can bill, but keeps
// that representation error from admitting an extra reservation.
const MONEY_EPSILON_USD = 1e-9;

export function canReserve(monthlyUsd: number, spentUsd: number, reserveUsd: number): boolean {
  if (isOverBudget(monthlyUsd, spentUsd)) return false;
  return spentUsd + reserveUsd <= monthlyUsd + MONEY_EPSILON_USD;
}

export function remainingUsd(monthlyUsd: number, spentUsd: number): number {
  return Math.max(0, monthlyUsd - spentUsd);
}
