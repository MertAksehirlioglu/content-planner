/** Admin-SDK reads/writes for budget + spend. Not unit-tested (imports the SDK); the arithmetic
 *  lives in the pure modules and the concurrency behaviour is covered by the emulator test in
 *  functions/test/budget-concurrency.test.ts. */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { canReserve, resolveMonthlyUsd, type BudgetDoc } from "./budget.js";

export interface BudgetState { monthlyUsd: number; spentUsd: number }

const budgetRef = (db: Firestore, uid: string) =>
  db.doc(`users/${uid}/billing/budget`);
const spendRef = (db: Firestore, uid: string, month: string) =>
  db.doc(`users/${uid}/billing/spend_${month}`);

export async function readBudgetState(db: Firestore, uid: string, month: string): Promise<BudgetState> {
  const [budgetSnap, spendSnap] = await Promise.all([
    budgetRef(db, uid).get(),
    spendRef(db, uid, month).get(),
  ]);
  return {
    monthlyUsd: resolveMonthlyUsd(budgetSnap.data() as BudgetDoc | undefined),
    spentUsd: (spendSnap.data()?.totalUsd as number | undefined) ?? 0,
  };
}

export interface Reservation extends BudgetState { ok: boolean }

/**
 * Check the cap and take the hold in ONE transaction.
 *
 * This is the whole point: reading spend and writing it back as two operations lets N concurrent
 * callers all observe the same pre-spend total, all pass the cap check, and all call the model —
 * turning a $5 cap into $5 x N. Firestore retries a transaction whose read set changed, so
 * concurrent reservations serialize and the (N+1)th sees the first N holds.
 *
 * Returns ok:false rather than throwing so the caller owns the user-facing error.
 */
export async function reserveSpend(
  db: Firestore, uid: string, month: string, reserve: number,
): Promise<Reservation> {
  return db.runTransaction(async (tx) => {
    const [budgetSnap, spendSnap] = await tx.getAll(budgetRef(db, uid), spendRef(db, uid, month));
    const monthlyUsd = resolveMonthlyUsd(budgetSnap.data() as BudgetDoc | undefined);
    const spentUsd = (spendSnap.data()?.totalUsd as number | undefined) ?? 0;

    if (!canReserve(monthlyUsd, spentUsd, reserve)) {
      return { ok: false, monthlyUsd, spentUsd };
    }

    // Write the absolute total rather than FieldValue.increment: the transaction already
    // guarantees spentUsd is current, and an explicit value keeps the read and the write
    // provably consistent.
    tx.set(spendRef(db, uid, month), {
      totalUsd: spentUsd + reserve, updatedAt: Date.now(),
    }, { merge: true });
    return { ok: true, monthlyUsd, spentUsd };
  });
}

/**
 * Replace the hold with the real charge and append the usage event the UI lists.
 * `actual - reserve` is usually negative — the hold is deliberately generous — so this is
 * normally a refund. byAccount gets the actual, never the hold, so the per-workspace
 * breakdown stays exact.
 *
 * The spend document stays under users/{uid} and keeps its `byAccount` field name: workspace
 * ids *are* the old account ids, so existing month-to-date totals and their breakdown survive
 * the workspace migration untouched. Only the usage event moved.
 */
export async function settleSpend(
  db: Firestore,
  args: { uid: string; workspaceId: string; month: string; reserve: number; actual: number;
          event: Record<string, unknown> },
): Promise<void> {
  const { uid, workspaceId, month, reserve, actual, event } = args;
  const batch = db.batch();
  batch.set(spendRef(db, uid, month), {
    totalUsd: FieldValue.increment(actual - reserve),
    byAccount: { [workspaceId]: FieldValue.increment(actual) },
    updatedAt: Date.now(),
  }, { merge: true });
  batch.set(db.collection(`workspaces/${workspaceId}/usage`).doc(), {
    ...event, createdAt: Date.now(),
  });
  await batch.commit();
}

/** Give the hold back when the model call never happened. Best-effort: a failure here leaks the
 *  hold until the month rolls over, which is the safe direction to fail. */
export async function releaseSpend(
  db: Firestore, uid: string, month: string, reserve: number,
): Promise<void> {
  await spendRef(db, uid, month).set({
    totalUsd: FieldValue.increment(-reserve), updatedAt: Date.now(),
  }, { merge: true });
}
