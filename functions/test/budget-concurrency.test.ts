// Proves the budget cap actually holds under concurrent calls — the bug the reserve/settle
// rewrite exists to fix. NOT part of `npm test` (imports the Admin SDK and needs the Firestore
// emulator); it lives outside src/ so the pure suite never picks it up. Run with:
//   npm --prefix functions run test:budget
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Exercise the compiled module: production imports use `.js` specifiers, which Node cannot
// resolve against raw `.ts` files. The npm script builds before starting the emulator.
import { reserveSpend, settleSpend, releaseSpend, readBudgetState } from "../lib/billing-store.js";

let app: App;
let db: Firestore;
const MONTH = "2026-08";

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,
    "FIRESTORE_EMULATOR_HOST unset — run via `npm --prefix functions run test:budget`");
  app = initializeApp({ projectId: "demo-content-planner" });
  db = getFirestore(app);
});
after(() => deleteApp(app));

async function seed(uid: string, monthlyUsd: number) {
  await db.doc(`users/${uid}/billing/budget`).set({ monthlyUsd });
  await db.doc(`users/${uid}/billing/spend_${MONTH}`).delete();
}

test("concurrent reservations cannot exceed the cap", async () => {
  const uid = "racer";
  await seed(uid, 1.0);

  // 40 simultaneous callers, each holding $0.10 against a $1.00 cap. Before the transaction
  // they would all read spent=0, all pass the check, and all call the model — $4.00 of spend
  // on a $1.00 budget. Serialized, exactly ten fit.
  const results = await Promise.all(
    Array.from({ length: 40 }, () => reserveSpend(db, uid, MONTH, 0.10)),
  );
  const granted = results.filter((r) => r.ok).length;
  const { spentUsd } = await readBudgetState(db, uid, MONTH);

  assert.equal(granted, 10, `expected 10 grants for a $1.00 cap at $0.10, got ${granted}`);
  assert.ok(Math.abs(spentUsd - 1.0) < 1e-9, `held total should be exactly the cap, got ${spentUsd}`);
});

test("a reservation is refused once the cap is already reached", async () => {
  const uid = "maxed";
  await seed(uid, 0.5);
  await db.doc(`users/${uid}/billing/spend_${MONTH}`).set({ totalUsd: 0.5 });

  const result = await reserveSpend(db, uid, MONTH, 0.01);
  assert.equal(result.ok, false);
});

test("settling swaps the hold for the real charge and credits the workspace", async () => {
  const uid = "settler";
  await seed(uid, 5);

  await reserveSpend(db, uid, MONTH, 0.10);
  await settleSpend(db, {
    uid, workspaceId: "acct1", month: MONTH, reserve: 0.10, actual: 0.02,
    event: { operation: "plan", model: "gemini-3.6-flash" },
  });

  const { spentUsd } = await readBudgetState(db, uid, MONTH);
  assert.ok(Math.abs(spentUsd - 0.02) < 1e-9, `hold should be replaced by the actual, got ${spentUsd}`);

  const spend = await db.doc(`users/${uid}/billing/spend_${MONTH}`).get();
  // byAccount keeps its field name and its key: a workspace id IS the old account id, so
  // month-to-date breakdowns survive the migration.
  assert.ok(Math.abs((spend.data()?.byAccount?.acct1 ?? 0) - 0.02) < 1e-9,
    "per-workspace breakdown must record the actual, never the hold");

  // The spend counter stayed under the user; only the usage log moved to the shared workspace.
  const usage = await db.collection("workspaces/acct1/usage").get();
  assert.equal(usage.size, 1, "settling appends exactly one usage event");
});

test("releasing gives the whole hold back when the model call failed", async () => {
  const uid = "releaser";
  await seed(uid, 5);

  await reserveSpend(db, uid, MONTH, 0.10);
  await releaseSpend(db, uid, MONTH, 0.10);

  const { spentUsd } = await readBudgetState(db, uid, MONTH);
  assert.ok(Math.abs(spentUsd) < 1e-9, `failed call must cost nothing, got ${spentUsd}`);
});
