// Security rules test. NOT part of `npm test` (it imports the SDK and needs the Firestore
// emulator) — it lives outside src/ so the pure suite never picks it up. Run with:
//   npm --prefix functions run test:rules
// which wraps it in `firebase emulators:exec` from the repo root (where firebase.json is).
import { test, before, after, beforeEach } from "node:test";
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

// One shared brand: "me" owns it, "mate" was added, "stranger" was not.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("workspaces/w1").set({ name: "Acme", ownerUid: "me" });
    await db.doc("workspaces/w1/members/me").set({ uid: "me", email: "me@x.com" });
    await db.doc("workspaces/w1/members/mate").set({ uid: "mate", email: "mate@x.com" });
  });
});

test("every member reads and writes the same brand", async () => {
  for (const uid of ["me", "mate"]) {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(db.doc("workspaces/w1").update({ profile: { business: uid } }));
    await assertSucceeds(db.doc("workspaces/w1/items/i1").set({ summary: uid }));
    await assertSucceeds(db.doc("workspaces/w1/weeks/w-2026-W33").set({ weekKey: "2026-W33" }));
    // Image bytes live several levels under weeks/ — the recursive weeks rule must allow them.
    await assertSucceeds(db.doc("workspaces/w1/weeks/w-2026-W33/media/m1/chunks/00000").set({ data: "z" }));
    await assertSucceeds(db.doc("workspaces/w1/items/i1").get());
  }
});

test("a signed-in non-member cannot read or write the brand", async () => {
  const db = env.authenticatedContext("stranger").firestore();
  await assertFails(db.doc("workspaces/w1").get());
  await assertFails(db.doc("workspaces/w1").update({ name: "hijacked" }));
  await assertFails(db.doc("workspaces/w1/items/i1").set({ summary: "x" }));
  await assertFails(db.doc("workspaces/w1/items/i1").get());
  await assertFails(db.doc("workspaces/w1/weeks/w1/media/m1/chunks/00000").set({ data: "z" }));
  await assertFails(db.doc("workspaces/w1/usage/e1").get());
});

test("membership and usage are Admin-SDK-write-only, even for the owner", async () => {
  const db = env.authenticatedContext("me").firestore();
  // A client that could write members/* could grant itself any brand.
  await assertFails(db.doc("workspaces/w1/members/stranger").set({ uid: "stranger" }));
  await assertFails(db.doc("workspaces/w1/members/mate").delete());
  // The usage log is what the proxy writes; a client rewriting it would falsify history.
  await assertFails(db.doc("workspaces/w1/usage/e1").set({ estimatedUsd: 0 }));
  // Members may read both.
  await assertSucceeds(db.collection("workspaces/w1/members").get());
  await assertSucceeds(db.collection("workspaces/w1/usage").get());
});

test("a client cannot create a workspace or seize an existing one", async () => {
  const db = env.authenticatedContext("stranger").firestore();
  // Creation is the createWorkspace callable's job: the workspace doc and its owner member
  // doc must land together or the brand is unreachable.
  await assertFails(db.doc("workspaces/w2").set({ name: "mine", ownerUid: "stranger" }));
  const mate = env.authenticatedContext("mate").firestore();
  // A member may edit the brand but must not take it over.
  await assertFails(mate.doc("workspaces/w1").update({ ownerUid: "mate" }));
});

test("only the owner may delete the brand", async () => {
  await assertFails(env.authenticatedContext("mate").firestore().doc("workspaces/w1").delete());
  await assertSucceeds(env.authenticatedContext("me").firestore().doc("workspaces/w1").delete());
});

test("a user can find their own memberships and nobody else's", async () => {
  const mine = env.authenticatedContext("mate").firestore();
  await assertSucceeds(mine.collectionGroup("members").where("uid", "==", "mate").get());
  // The same query for someone else's uid must not be answerable.
  await assertFails(mine.collectionGroup("members").where("uid", "==", "me").get());
});

test("budgets stay per-user, readable by their owner and written by nobody", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("users/me/billing/budget").set({ monthlyUsd: 20 });
  });
  const mine = env.authenticatedContext("me").firestore();
  await assertSucceeds(mine.doc("users/me/billing/budget").get());
  // A user must never raise their own cap or reset their counter — sharing a brand changed
  // nothing here.
  await assertFails(mine.doc("users/me/billing/budget").set({ monthlyUsd: 9999 }));
  await assertFails(mine.doc("users/me/billing/spend_2026-08").set({ totalUsd: 0 }));
  // A workspace co-member has no claim on someone else's wallet.
  await assertFails(env.authenticatedContext("mate").firestore().doc("users/me/billing/budget").get());
});

test("legacy account data stays reachable until the migration is retired", async () => {
  const db = env.authenticatedContext("me").firestore();
  await assertSucceeds(db.doc("users/me/accounts/a1").set({ name: "Acme" }));
  await assertSucceeds(db.doc("users/me/accounts/a1/weeks/w1/media/m1/chunks/00000").set({ data: "z" }));
  await assertFails(env.authenticatedContext("stranger").firestore().doc("users/me/accounts/a1").get());
});
