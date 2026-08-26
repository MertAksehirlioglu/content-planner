#!/usr/bin/env node
/**
 * One-shot migration: users/{uid}/accounts/{accountId}/**  ->  workspaces/{accountId}/**
 *
 * Copies only. Nothing is deleted, so the old tree stays as the rollback until you have
 * verified the app against the new one and removed the legacy block from firestore.rules.
 *
 * Billing is deliberately untouched: users/{uid}/billing/budget and .../spend_{month} stay
 * exactly where they are and keep their `byAccount` breakdown, because the workspace id IS
 * the old account id. Shared brand, individual wallets.
 *
 *   node functions/scripts/migrate-workspaces.mjs                 # dry run, prints the plan
 *   node functions/scripts/migrate-workspaces.mjs --apply         # write
 *   node functions/scripts/migrate-workspaces.mjs --apply --force # re-copy over an existing workspace
 *
 * Auth: application default credentials (`gcloud auth application-default login`) plus
 * FIREBASE_PROJECT_ID, or GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key.
 *
 * The moving parts are exported so functions/test/migrate.test.ts can run them against the
 * emulator — this is the one script in the repo that could lose data.
 */

/** Copy a document and every subcollection beneath it. Depth is bounded by the data model
 *  (weeks -> media -> chunks), so plain recursion is fine. */
export async function copyTree(src, dst, write, counts, extra = {}) {
  const snap = await src.get();
  if (snap.exists) {
    write(dst, { ...snap.data(), ...extra });
    counts.docs += 1;
  }
  for (const collection of await src.listCollections()) {
    for (const child of await collection.listDocuments()) {
      await copyTree(child, dst.collection(collection.id).doc(child.id), write, counts);
    }
  }
}

/**
 * Walk every user's accounts and copy each one into a top-level workspace owned by them.
 * Idempotent: an existing workspace is skipped unless `force`, so a partial run is safe to
 * repeat. Returns the tally so a caller (or a test) can assert on it.
 */
export async function migrate(db, { apply = false, force = false, emailFor, log = console.log }) {
  // BulkWriter batches and retries for us, which matters here: week media chunks are ~700 KB
  // each, so a fixed 500-write batch would blow the 10 MB commit limit.
  const writer = apply ? db.bulkWriter() : null;
  const failures = [];
  const write = (ref, data) => {
    if (!writer) return;
    writer.set(ref, data).catch((err) => failures.push(`${ref.path}: ${err.message}`));
  };

  let migrated = 0, skipped = 0, docs = 0;
  for (const user of await db.collection("users").listDocuments()) {
    const uid = user.id;
    for (const account of await user.collection("accounts").listDocuments()) {
      // A subcollection can outlive its parent document; such an account has no brand to move.
      if (!(await account.get()).exists) continue;
      const target = db.doc(`workspaces/${account.id}`);
      if ((await target.get()).exists && !force) {
        log(`skip  ${uid}/${account.id} — workspaces/${account.id} already exists`);
        skipped += 1;
        continue;
      }

      const counts = { docs: 0 };
      await copyTree(account, target, write, counts,
        { ownerUid: uid, migratedFrom: uid, migratedAt: Date.now() });
      // The owner's member document is what actually grants access; without it the copied
      // brand is unreachable from the browser.
      write(target.collection("members").doc(uid), {
        uid, email: await emailFor(uid), addedAt: Date.now(), addedBy: "migration",
      });
      log(`copy  ${uid}/${account.id} -> workspaces/${account.id}  (${counts.docs} docs + 1 member)`);
      migrated += 1;
      docs += counts.docs;
    }
  }

  if (writer) await writer.close();
  return { migrated, skipped, docs, failures };
}

// CLI entry. Skipped when the test imports this module.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");

  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) {
    console.error("Set FIREBASE_PROJECT_ID to the project you want to migrate.");
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth();
  const emailFor = async (uid) => {
    try {
      return (await auth.getUser(uid)).email?.toLowerCase() ?? "";
    } catch {
      // A deleted auth user can still own account documents. Migrate the data anyway — the
      // member doc is keyed by uid, and the email is only ever shown in the members list.
      return "";
    }
  };

  const result = await migrate(getFirestore(), { apply, force, emailFor });
  console.log(`\n${apply ? "migrated" : "would migrate"} ${result.migrated} workspace(s)`
    + ` (${result.docs} documents), skipped ${result.skipped}.`);
  if (!apply) console.log("Dry run — nothing was written. Re-run with --apply.");
  if (result.failures.length) {
    console.error(`\n${result.failures.length} write(s) failed:`);
    for (const failure of result.failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}
