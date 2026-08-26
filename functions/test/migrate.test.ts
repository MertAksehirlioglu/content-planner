// Proves the one-shot workspace migration copies everything and loses nothing — it is the
// only script in the repo that could destroy data. NOT part of `npm test` (imports the Admin
// SDK and needs the Firestore emulator). Run with:
//   npm --prefix functions run test:migrate
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { migrate } from "../scripts/migrate-workspaces.mjs";

let app: App;
let db: Firestore;
const emailFor = async (uid: string) => `${uid}@example.com`;

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,
    "FIRESTORE_EMULATOR_HOST unset — run via `npm --prefix functions run test:migrate`");
  app = initializeApp({ projectId: "demo-content-planner" });
  db = getFirestore(app);
});
after(() => deleteApp(app));

// One user with one brand: a profile, a saved item, a week, and image bytes three levels down.
beforeEach(async () => {
  await db.recursiveDelete(db.collection("users"));
  await db.recursiveDelete(db.collection("workspaces"));
  await db.doc("users/u1/accounts/a1").set({ name: "Acme", profile: { business: "widgets" } });
  await db.doc("users/u1/accounts/a1/items/i1").set({ summary: "an idea", status: "backlog" });
  await db.doc("users/u1/accounts/a1/weeks/2026-W33").set({ weekKey: "2026-W33" });
  await db.doc("users/u1/accounts/a1/weeks/2026-W33/media/m1").set({ chunkCount: 1 });
  await db.doc("users/u1/accounts/a1/weeks/2026-W33/media/m1/chunks/00000").set({ data: "AAAA" });
  await db.doc("users/u1/accounts/a1/usage/e1").set({ estimatedUsd: 0.02 });
  await db.doc("users/u1/billing/budget").set({ monthlyUsd: 20 });
  await db.doc("users/u1/billing/spend_2026-08").set({ totalUsd: 3, byAccount: { a1: 3 } });
});

test("a dry run writes nothing", async () => {
  const result = await migrate(db, { apply: false, emailFor, log: () => {} });
  assert.equal(result.migrated, 1);
  assert.equal((await db.doc("workspaces/a1").get()).exists, false);
});

test("the whole tree lands under the workspace, owned by the original user", async () => {
  const result = await migrate(db, { apply: true, emailFor, log: () => {} });
  assert.deepEqual(result.failures, []);

  const workspace = await db.doc("workspaces/a1").get();
  assert.equal(workspace.data()?.name, "Acme");
  assert.equal(workspace.data()?.profile?.business, "widgets");
  assert.equal(workspace.data()?.ownerUid, "u1", "ownerUid is what the callables and rules trust");

  // The member document is what actually grants access; without it the brand is unreachable.
  const member = await db.doc("workspaces/a1/members/u1").get();
  assert.equal(member.data()?.uid, "u1");
  assert.equal(member.data()?.email, "u1@example.com");

  assert.equal((await db.doc("workspaces/a1/items/i1").get()).data()?.summary, "an idea");
  assert.equal((await db.doc("workspaces/a1/weeks/2026-W33").get()).exists, true);
  // Image bytes are three levels down; a shallow copy would silently drop every picture.
  assert.equal((await db.doc("workspaces/a1/weeks/2026-W33/media/m1/chunks/00000").get()).data()?.data, "AAAA");
  assert.equal((await db.doc("workspaces/a1/usage/e1").get()).data()?.estimatedUsd, 0.02);
});

test("the source tree is left intact as the rollback", async () => {
  await migrate(db, { apply: true, emailFor, log: () => {} });
  assert.equal((await db.doc("users/u1/accounts/a1").get()).exists, true);
  assert.equal((await db.doc("users/u1/accounts/a1/weeks/2026-W33/media/m1/chunks/00000").get()).exists, true);
});

test("budgets and month-to-date spend are untouched — that is the point of the design", async () => {
  await migrate(db, { apply: true, emailFor, log: () => {} });
  const budget = await db.doc("users/u1/billing/budget").get();
  const spend = await db.doc("users/u1/billing/spend_2026-08").get();
  assert.equal(budget.data()?.monthlyUsd, 20);
  assert.equal(spend.data()?.totalUsd, 3);
  // The workspace id IS the old account id, so the breakdown keeps pointing at the right brand.
  assert.equal(spend.data()?.byAccount?.a1, 3);
});

test("re-running skips what already moved, so a partial run is safe to repeat", async () => {
  await migrate(db, { apply: true, emailFor, log: () => {} });
  await db.doc("workspaces/a1").update({ name: "renamed since" });

  const again = await migrate(db, { apply: true, emailFor, log: () => {} });
  assert.equal(again.migrated, 0);
  assert.equal(again.skipped, 1);
  assert.equal((await db.doc("workspaces/a1").get()).data()?.name, "renamed since",
    "a second run must not clobber work done after the first");

  const forced = await migrate(db, { apply: true, force: true, emailFor, log: () => {} });
  assert.equal(forced.migrated, 1);
  assert.equal((await db.doc("workspaces/a1").get()).data()?.name, "Acme");
});

test("an account subcollection that outlived its document is not resurrected", async () => {
  await db.doc("users/u2/accounts/ghost/items/i9").set({ summary: "orphan" });
  const result = await migrate(db, { apply: true, emailFor, log: () => {} });
  assert.equal(result.migrated, 1, "only the real account moves");
  assert.equal((await db.doc("workspaces/ghost").get()).exists, false);
});
