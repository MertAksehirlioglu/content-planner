// Security rules test. NOT part of `npm test` (it imports the SDK and needs the Firestore
// emulator) — it lives outside src/ so the pure suite never picks it up. Run with:
//   npm --prefix functions run test:rules
// which wraps it in `firebase emulators:exec` from the repo root (where firebase.json is).
import { test, before, after } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";

let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-content-planner",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
after(() => env.cleanup());

test("owner can write account data (incl. nested media) but not billing or usage", async () => {
  const db = env.authenticatedContext("me").firestore();
  await assertSucceeds(db.doc("users/me/accounts/a1").set({ name: "Acme" }));
  await assertSucceeds(db.doc("users/me/accounts/a1/items/i1").set({ summary: "x" }));
  await assertSucceeds(db.doc("users/me/accounts/a1/weeks/w1").set({ weekKey: "w1" }));
  // Image bytes live several levels under weeks/ — the recursive weeks rule must allow them.
  await assertSucceeds(db.doc("users/me/accounts/a1/weeks/w1/media/m1/chunks/00000").set({ data: "z" }));
  // The counters and history the app displays are proxy-written only.
  await assertFails(db.doc("users/me/billing/budget").set({ monthlyUsd: 9999 }));
  await assertFails(db.doc("users/me/billing/spend_2026-08").set({ totalUsd: 0 }));
  await assertFails(db.doc("users/me/accounts/a1/usage/e1").set({ estimatedUsd: 0 }));
});

test("owner can read their budget/spend; a stranger cannot", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("users/me/billing/budget").set({ monthlyUsd: 20 });
  });
  const mine = env.authenticatedContext("me").firestore();
  await assertSucceeds(mine.doc("users/me/billing/budget").get());
  const other = env.authenticatedContext("someone").firestore();
  await assertFails(other.doc("users/me/billing/budget").get());
});
