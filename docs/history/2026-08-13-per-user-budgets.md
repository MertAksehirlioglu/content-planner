# Per-User Budgets & Usage Limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner per-user monthly USD budgets that users cannot modify or bypass, hard-block generation server-side when a user is over budget, and let both the owner (all users) and each user (themselves) see spend.

**Architecture:** The Gemini call already runs behind a server proxy (assumed prerequisite — see Preconditions). Metering, budget lookup, and the hard block all live **inside that proxy**, which is the only writer of the authoritative spend counter and budget docs. Clients can *read* their budget/spend for display but can never write them — enforced by rewritten `firestore.rules` (least-privilege) plus two admin-only callables gated by an `ADMIN_EMAILS` secret. Budget/enforcement math is factored into pure, `node --test`-able modules; Firestore/Admin-SDK glue is thin and verified against the emulator.

**Tech Stack:** Firebase Cloud Functions v2 (`europe-west1`), Firebase Admin SDK (Firestore + Auth), Firestore security rules, Next.js/Mantine client, `firebase/functions` httpsCallable, `node --test` (type-stripping, no network), Firebase emulators.

## Global Constraints

- **Function region is `europe-west1`** — every callable must set it, matching `gatekeeper`.
- **App Check** must gate every new callable (`enforceAppCheck: true`), same trust boundary as the existing AI Logic calls.
- **Secrets via `defineSecret`** — the admin list is `ADMIN_EMAILS`, comma-separated, in Secret Manager (never in the repo), mirroring `ALLOWED_EMAILS`.
- **`npm test` is `node --test`, pure logic only** — no `firebase/*`, no network, no Admin SDK in anything under test. Intra-repo imports keep the `.ts` extension (e.g. `import { costUsd } from "./cost.ts"`).
- **Immutability** — never mutate inputs; return new objects (repo house rule).
- **Fail closed** — an absent/empty `ADMIN_EMAILS` grants admin to nobody (inherited free from `isAllowed`).
- **Cost authority is the server.** After this plan, displayed cost comes from the server-recorded spend doc, not a client recompute. The client never writes usage or spend.

## Preconditions (assumed prerequisite — NOT built by this plan)

A server proxy already exists and is the sole path from browser to Gemini:

- `functions/src/generate.ts` exports a callable `generate` registered in `functions/src/index.ts`, region `europe-west1`, `enforceAppCheck: true`.
- The client invokes it via `httpsCallable(functions, "generate")` from `lib/gemini.ts` instead of calling `firebase/ai` directly.
- Its request payload includes at least: `{ accountId: string, operation: UsageEvent["operation"], … model inputs }`.
- Internally it calls Gemini, and *before this plan* returns `{ data, usage, model, imageCount }`, where `usage` matches `UsageSnapshot` from `lib/cost.ts` and `imageCount` is the number of images generated (0 for text ops).
- `context.auth.uid` and `context.auth.token.email` are available inside the callable.

If any of the above differs, adjust the wiring in **Task 6** accordingly; the pure modules (Tasks 1–3) are independent of proxy shape.

---

## File Structure

**New (functions):**
- `functions/src/cost.ts` — pure authoritative cost math (server copy of the `lib/cost.ts` rate table) + `monthKey`.
- `functions/src/cost.test.ts` — `node --test`.
- `functions/src/budget.ts` — pure budget resolution/over-budget/remaining logic + `DEFAULT_MONTHLY_USD`.
- `functions/src/budget.test.ts` — `node --test`.
- `functions/src/billing-store.ts` — Admin-SDK Firestore glue: read budget+spend, atomically record spend + usage event.
- `functions/src/admin-api.ts` — `setBudget` + `listUsers` callables, gated by `ADMIN_EMAILS` via `isAllowed`.
- `functions/src/rules.test.ts` (optional, recommended) — `@firebase/rules-unit-testing` against the emulator.

**Modified (functions):**
- `functions/src/generate.ts` — add pre-check block + post-call metering/recording (Preconditions describe its current shape).
- `functions/src/index.ts` — export the two admin callables.

**Modified (rules & config):**
- `firestore.rules` — rewrite to least-privilege: account data writable by owner; `billing/*` and `usage/*` read-only to client.
- `functions/package.json` — add `@firebase/rules-unit-testing` devDep + `test:rules` script (only if doing the optional rules test).

**New / modified (client):**
- `lib/billing.ts` — client reads of `budget` + `spend` docs; typed wrappers over the `setBudget`/`listUsers` callables.
- `app/page.tsx` — `CostSummary` reads server spend (cap/spent/remaining + per-account); new `AdminPanel`; catch the over-budget error.
- `lib/store.ts` — remove the client `addUsage` write path (usage is now server-written); keep `listUsage` for the history list (now read-only).

**Data model (Firestore):**
```
users/{uid}/billing/budget                { monthlyUsd: number, updatedBy: string, updatedAt: number }   ← admin-write only
users/{uid}/billing/spend_{YYYY-MM}       { totalUsd: number, byAccount: {[accId]: number}, updatedAt } ← proxy-write only
users/{uid}/accounts/{accId}/usage/{ev}   UsageEvent (per-event history)                                 ← proxy-write only
users/{uid}/accounts/{accId}/{items,weeks,…}  unchanged                                                  ← owner-writable
```
Both `billing` docs and `usage` events are written **only** by the Admin SDK (which bypasses rules); the client can read them but rules deny client writes. That read-only counter is the entire "safe" guarantee.

---

## Task 1: Pure server cost module

**Files:**
- Create: `functions/src/cost.ts`
- Test: `functions/src/cost.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface UsageSnapshot { promptTokens: number; outputTokens: number; thinkingTokens: number; totalTokens: number; outputImageTokens: number; cachedTokens: number; }`
  - `function costUsd(model: string, usage: UsageSnapshot, imageCount?: number): number`
  - `function monthKey(date: Date): string` → `"YYYY-MM"` in UTC.

> **DRY note:** the rate table is a verbatim copy of `estimateCost` in `lib/cost.ts`. The client and server live in separate package roots with no shared module, so this is duplicated on purpose.
> `// ponytail: rates mirror lib/cost.ts; a shared package is overkill for 4 model rates — keep them in sync by hand.`

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/cost.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd, monthKey, type UsageSnapshot } from "./cost.ts";

const empty: UsageSnapshot = {
  promptTokens: 0, outputTokens: 0, thinkingTokens: 0,
  totalTokens: 0, outputImageTokens: 0, cachedTokens: 0,
};

test("text model bills input + (output+thinking)", () => {
  const usage = { ...empty, promptTokens: 1_000_000, outputTokens: 1_000_000, thinkingTokens: 0 };
  // gemini-3.6-flash: $0.75/M in + $3.75/M out
  assert.equal(costUsd("gemini-3.6-flash", usage), 0.75 + 3.75);
});

test("image model uses per-image fallback when no image tokens reported", () => {
  // gemini-3.1-flash-image fallback: $0.067/image, plus $0 tokens here
  assert.ok(Math.abs(costUsd("gemini-3.1-flash-image", empty, 2) - 0.134) < 1e-9);
});

test("unknown model costs 0", () => {
  assert.equal(costUsd("made-up", empty, 5), 0);
});

test("monthKey is UTC YYYY-MM", () => {
  assert.equal(monthKey(new Date("2026-08-13T23:30:00Z")), "2026-08");
  assert.equal(monthKey(new Date("2026-01-01T00:00:00Z")), "2026-01");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/src/cost.test.ts`
Expected: FAIL — `Cannot find module './cost.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// functions/src/cost.ts
/** Authoritative server-side cost of one model call. Pure: no SDK, so node --test runs it.
 *  ponytail: rates mirror lib/cost.ts; keep them in sync by hand (4 rows, not worth a shared pkg). */

export interface UsageSnapshot {
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  outputImageTokens: number;
  cachedTokens: number;
}

export function costUsd(model: string, usage: UsageSnapshot, imageCount = 0): number {
  const out = usage.outputTokens + usage.thinkingTokens;
  if (model === "gemini-3.6-flash") {
    return usage.promptTokens * 0.75 / 1_000_000 + out * 3.75 / 1_000_000;
  }
  if (model === "gemini-3.1-flash-lite") {
    return usage.promptTokens * 0.25 / 1_000_000 + out * 1.5 / 1_000_000;
  }
  if (model === "gemini-3.1-flash-image") {
    const imageUsd = usage.outputImageTokens
      ? usage.outputImageTokens * 60 / 1_000_000
      : imageCount * 0.067;
    return usage.promptTokens * 0.50 / 1_000_000
      + Math.max(0, out - usage.outputImageTokens) * 3 / 1_000_000
      + imageUsd;
  }
  if (model === "gemini-3.1-flash-lite-image") {
    return usage.promptTokens * 0.25 / 1_000_000
      + Math.max(0, out - usage.outputImageTokens) * 1.5 / 1_000_000
      + imageCount * 0.0336;
  }
  return 0; // unknown model → don't bill against budget
}

export function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/src/cost.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add functions/src/cost.ts functions/src/cost.test.ts
git commit -m "feat(budget): pure server-side cost + monthKey"
```

---

## Task 2: Pure budget module

**Files:**
- Create: `functions/src/budget.ts`
- Test: `functions/src/budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const DEFAULT_MONTHLY_USD: number` (= 5) — cap for a signed-in user with no budget doc yet.
  - `interface BudgetDoc { monthlyUsd?: number }`
  - `function resolveMonthlyUsd(doc: BudgetDoc | undefined): number` — `doc.monthlyUsd` when it's a finite ≥0 number, else `DEFAULT_MONTHLY_USD`.
  - `function isOverBudget(monthlyUsd: number, spentUsd: number): boolean` — `spentUsd >= monthlyUsd`.
  - `function remainingUsd(monthlyUsd: number, spentUsd: number): number` — `Math.max(0, monthlyUsd - spentUsd)`.

> The block decision is `isOverBudget`. It's **check-before / record-after** (cost is only known post-generation), so a single call can push a user slightly negative for the month; the *next* call is blocked. Bounded by max single-call cost.
> `// ponytail: check-before/record-after — one call can overshoot the cap. Add a pre-auth hold (reserve estimate, settle actual) only if overage ever matters.`

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/budget.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MONTHLY_USD, resolveMonthlyUsd, isOverBudget, remainingUsd } from "./budget.ts";

test("missing / malformed budget doc falls back to default", () => {
  assert.equal(resolveMonthlyUsd(undefined), DEFAULT_MONTHLY_USD);
  assert.equal(resolveMonthlyUsd({}), DEFAULT_MONTHLY_USD);
  assert.equal(resolveMonthlyUsd({ monthlyUsd: Number.NaN }), DEFAULT_MONTHLY_USD);
  assert.equal(resolveMonthlyUsd({ monthlyUsd: -3 }), DEFAULT_MONTHLY_USD);
});

test("explicit budget wins, including zero (a hard stop)", () => {
  assert.equal(resolveMonthlyUsd({ monthlyUsd: 20 }), 20);
  assert.equal(resolveMonthlyUsd({ monthlyUsd: 0 }), 0);
});

test("over budget when spend reaches or exceeds cap", () => {
  assert.equal(isOverBudget(10, 9.99), false);
  assert.equal(isOverBudget(10, 10), true);
  assert.equal(isOverBudget(0, 0), true); // zero budget blocks immediately
});

test("remaining never goes negative", () => {
  assert.equal(remainingUsd(10, 3), 7);
  assert.equal(remainingUsd(10, 12), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/src/budget.test.ts`
Expected: FAIL — `Cannot find module './budget.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// functions/src/budget.ts
/** Pure budget arithmetic. No SDK, so node --test runs it. */

export const DEFAULT_MONTHLY_USD = 5;

export interface BudgetDoc { monthlyUsd?: number }

export function resolveMonthlyUsd(doc: BudgetDoc | undefined): number {
  const v = doc?.monthlyUsd;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_MONTHLY_USD;
}

export function isOverBudget(monthlyUsd: number, spentUsd: number): boolean {
  return spentUsd >= monthlyUsd;
}

export function remainingUsd(monthlyUsd: number, spentUsd: number): number {
  return Math.max(0, monthlyUsd - spentUsd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/src/budget.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add functions/src/budget.ts functions/src/budget.test.ts
git commit -m "feat(budget): pure budget resolution + over-budget check"
```

---

## Task 3: Billing store (Admin-SDK Firestore glue)

**Files:**
- Create: `functions/src/billing-store.ts`

**Interfaces:**
- Consumes: `resolveMonthlyUsd`, `monthKey`, `costUsd` (Tasks 1–2); `firebase-admin/firestore`.
- Produces:
  - `interface BudgetState { monthlyUsd: number; spentUsd: number }`
  - `async function readBudgetState(db: Firestore, uid: string, month: string): Promise<BudgetState>`
  - `async function recordSpend(db: Firestore, args: { uid: string; accountId: string; month: string; cost: number; event: Record<string, unknown> }): Promise<void>`

This file touches Firestore, so it is **not** in the `node --test` suite (it would import the Admin SDK). All arithmetic it needs already lives in Tasks 1–2; keep this file to reads/writes only. Verified via the emulator in Task 6.

- [ ] **Step 1: Write the implementation**

```ts
// functions/src/billing-store.ts
/** Admin-SDK reads/writes for budget + spend. Not unit-tested (imports the SDK);
 *  all math is delegated to the pure modules. Verified against the emulator. */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { resolveMonthlyUsd, type BudgetDoc } from "./budget.ts";

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
  const monthlyUsd = resolveMonthlyUsd(budgetSnap.data() as BudgetDoc | undefined);
  const spentUsd = (spendSnap.data()?.totalUsd as number | undefined) ?? 0;
  return { monthlyUsd, spentUsd };
}

export async function recordSpend(
  db: Firestore,
  args: { uid: string; accountId: string; month: string; cost: number; event: Record<string, unknown> },
): Promise<void> {
  const { uid, accountId, month, cost, event } = args;
  const batch = db.batch();
  // Atomic increment of the authoritative counter (total + per-account breakdown).
  batch.set(spendRef(db, uid, month), {
    totalUsd: FieldValue.increment(cost),
    byAccount: { [accountId]: FieldValue.increment(cost) },
    updatedAt: Date.now(),
  }, { merge: true });
  // Append the per-event history doc the UI lists.
  batch.set(db.collection(`users/${uid}/accounts/${accountId}/usage`).doc(), {
    ...event, createdAt: Date.now(),
  });
  await batch.commit();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix functions run build`
Expected: no type errors (emulator verification happens in Task 6).

- [ ] **Step 3: Commit**

```bash
git add functions/src/billing-store.ts
git commit -m "feat(budget): admin-sdk budget/spend store"
```

---

## Task 4: Rewrite firestore.rules to least-privilege

**Files:**
- Modify: `firestore.rules`
- Create (optional, recommended): `functions/src/rules.test.ts`, and a `test:rules` script.

**Interfaces:**
- Produces: `billing/*` and `usage/*` are client-**read**-only; account data stays owner-writable.

> **Why a rewrite, not an addition:** Firestore grants access if *any* matching rule allows it. The current `match /users/{uid}/{document=**} { allow read, write }` recursively covers `billing/*`, so adding a separate read-only billing rule would not restrict anything — the wildcard still allows the write. The recursive rule must be replaced with explicit per-collection rules. Any subcollection not listed is denied (fail-closed) — the collections in use are `accounts`, `accounts/*/items`, `accounts/*/weeks`, `accounts/*/usage` (see `lib/store.ts`).

- [ ] **Step 1: Replace the rules body**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }
    match /users/{uid} {
      // Owner-writable account data.
      match /accounts/{account} {
        allow read, write: if isOwner(uid);
        match /items/{item} { allow read, write: if isOwner(uid); }
        match /weeks/{week} { allow read, write: if isOwner(uid); }
        // Usage events are written only by the proxy (Admin SDK); client may read.
        match /usage/{event} {
          allow read: if isOwner(uid);
          allow write: if false;
        }
      }
      // Budget + spend counters: read-only to the owner, written only by the Admin SDK.
      match /billing/{doc} {
        allow read: if isOwner(uid);
        allow write: if false;
      }
    }
  }
}
```

- [ ] **Step 2 (optional, recommended): Add the rules test**

In `functions/package.json` add devDep `@firebase/rules-unit-testing` and script:
`"test:rules": "firebase emulators:exec --only firestore \"node --test src/rules.test.ts\""`

```ts
// functions/src/rules.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";

let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-budget",
    firestore: { rules: readFileSync("../firestore.rules", "utf8") },
  });
});
after(() => env.cleanup());

test("owner can write their account, not their budget or usage", async () => {
  const db = env.authenticatedContext("me").firestore();
  await assertSucceeds(db.doc("users/me/accounts/a1").set({ name: "Acme" }));
  await assertSucceeds(db.doc("users/me/accounts/a1/items/i1").set({ summary: "x" }));
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
```

- [ ] **Step 3: Run the rules test**

Run: `npm --prefix functions run test:rules`
Expected: PASS. (If skipping the optional test, instead verify manually in Task 6 with the emulator UI.)

- [ ] **Step 4: Commit**

```bash
git add firestore.rules functions/src/rules.test.ts functions/package.json
git commit -m "feat(budget): lock billing + usage to read-only in rules"
```

---

## Task 5: Admin callables — setBudget & listUsers

**Files:**
- Create: `functions/src/admin-api.ts`
- Modify: `functions/src/index.ts` (export both)

**Interfaces:**
- Consumes: `isAllowed` (`./allowlist.ts`), `readBudgetState` (Task 3), `monthKey` (Task 1), `remainingUsd` (Task 2), `firebase-admin`.
- Produces two callables:
  - `setBudget({ uid: string, monthlyUsd: number }) → { ok: true }`
  - `listUsers() → { users: Array<{ uid: string; email: string; monthlyUsd: number; spentUsd: number; remainingUsd: number }> }`
  - Both throw `HttpsError("permission-denied", …)` unless the caller's verified email is in `ADMIN_EMAILS`.

- [ ] **Step 1: Write the implementation**

```ts
// functions/src/admin-api.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { isAllowed } from "./allowlist.ts";
import { monthKey } from "./cost.ts";
import { remainingUsd } from "./budget.ts";
import { readBudgetState } from "./billing-store.ts";

const adminEmails = defineSecret("ADMIN_EMAILS");
const OPTS = { secrets: [adminEmails], region: "europe-west1" as const, enforceAppCheck: true };

function assertAdmin(context: { auth?: { token?: { email?: string } } }): void {
  const email = context.auth?.token?.email;
  if (!isAllowed(email, adminEmails.value())) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

export const setBudget = onCall(OPTS, async (request) => {
  assertAdmin(request);
  const { uid, monthlyUsd } = request.data ?? {};
  if (typeof uid !== "string" || uid.trim() === "") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  if (typeof monthlyUsd !== "number" || !Number.isFinite(monthlyUsd) || monthlyUsd < 0) {
    throw new HttpsError("invalid-argument", "monthlyUsd must be a number >= 0.");
  }
  await getFirestore().doc(`users/${uid}/billing/budget`).set({
    monthlyUsd, updatedBy: request.auth!.token.email ?? "admin", updatedAt: Date.now(),
  }, { merge: true });
  return { ok: true as const };
});

export const listUsers = onCall(OPTS, async (request) => {
  assertAdmin(request);
  const db = getFirestore();
  const month = monthKey(new Date());
  const { users } = await getAuth().listUsers(1000);
  const rows = await Promise.all(users.map(async (u) => {
    const { monthlyUsd, spentUsd } = await readBudgetState(db, u.uid, month);
    return {
      uid: u.uid, email: u.email ?? "(no email)",
      monthlyUsd, spentUsd, remainingUsd: remainingUsd(monthlyUsd, spentUsd),
    };
  }));
  return { users: rows };
});
```

- [ ] **Step 2: Export from index.ts**

Add to `functions/src/index.ts`:
```ts
export { setBudget, listUsers } from "./admin-api.ts";
```
Ensure `firebase-admin` is initialized once (if `index.ts` doesn't already call `initializeApp()`, add `import { initializeApp } from "firebase-admin/app"; initializeApp();` guarded so it runs a single time).

- [ ] **Step 3: Typecheck**

Run: `npm --prefix functions run build`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add functions/src/admin-api.ts functions/src/index.ts
git commit -m "feat(budget): admin setBudget + listUsers callables"
```

---

## Task 6: Enforce + meter inside the proxy

**Files:**
- Modify: `functions/src/generate.ts` (assumed to exist — see Preconditions)

**Interfaces:**
- Consumes: `readBudgetState`, `recordSpend` (Task 3), `monthKey`, `costUsd` (Task 1), `isOverBudget`, `remainingUsd` (Task 2).
- Produces: the callable now (a) throws `HttpsError("resource-exhausted", …)` before calling Gemini when over budget, and (b) returns `remainingUsd` alongside the existing payload.

- [ ] **Step 1: Add the pre-check and post-record**

Wrap the existing Gemini logic. Illustrative shape (adapt to the real handler body):
```ts
// inside the generate onCall handler, after auth is resolved:
const uid = request.auth!.uid;
const accountId = request.data.accountId as string;
const month = monthKey(new Date());
const db = getFirestore();

// (a) hard block BEFORE spending anything
const { monthlyUsd, spentUsd } = await readBudgetState(db, uid, month);
if (isOverBudget(monthlyUsd, spentUsd)) {
  throw new HttpsError(
    "resource-exhausted",
    "Monthly budget reached. Contact the owner to raise it.",
  );
}

// ... existing Gemini call → produces { data, usage, model, imageCount } ...

// (b) meter + record AFTER
const cost = costUsd(model, usage, imageCount);
await recordSpend(db, {
  uid, accountId, month, cost,
  event: { operation: request.data.operation, model, usage, imageCount, estimatedUsd: cost },
});

return { data, usage, model, imageCount, remainingUsd: remainingUsd(monthlyUsd, spentUsd + cost) };
```

> `// ponytail: pre-check and increment are separate (can't hold a txn across the Gemini call). Concurrent calls can both pass the check → bounded overage. FieldValue.increment keeps the counter itself race-free.`

- [ ] **Step 2: Typecheck**

Run: `npm --prefix functions run build`
Expected: no type errors.

- [ ] **Step 3: Emulator smoke test**

Run: `npm run preview` (build + emulators: Hosting + functions + Firestore).
Verify, signed in as a test user:
1. Set that user's budget to `0.001` via the `setBudget` callable (or the emulator UI writing `users/{uid}/billing/budget`).
2. First generation may succeed once (records spend, tips over).
3. Next generation fails with the "Monthly budget reached" error.
4. `users/{uid}/billing/spend_{month}.totalUsd` and `.byAccount[accId]` increased; a `usage` doc was appended.
5. In the emulator UI, signed-in-user write to `billing/budget` or `usage` is **rejected** (rules).

- [ ] **Step 4: Commit**

```bash
git add functions/src/generate.ts
git commit -m "feat(budget): enforce budget + meter spend in the proxy"
```

---

## Task 7: Client billing module

**Files:**
- Create: `lib/billing.ts`

**Interfaces:**
- Consumes: `db` (`@/lib/firebase`), `firebase/firestore`, `firebase/functions`.
- Produces:
  - `interface Budget { monthlyUsd: number }`
  - `interface Spend { totalUsd: number; byAccount: Record<string, number> }`
  - `interface AdminUserRow { uid: string; email: string; monthlyUsd: number; spentUsd: number; remainingUsd: number }`
  - `async function loadBudget(uid: string): Promise<Budget | null>`
  - `async function loadSpend(uid: string, month: string): Promise<Spend>`
  - `function currentMonthKey(): string` (client copy of `monthKey`, UTC)
  - `async function callSetBudget(uid: string, monthlyUsd: number): Promise<void>`
  - `async function callListUsers(): Promise<AdminUserRow[] | null>` — returns `null` on `permission-denied` (caller isn't admin), so the UI can hide the panel without knowing the secret.

- [ ] **Step 1: Implement**

```ts
// lib/billing.ts
import { doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db, app } from "@/lib/firebase";

export interface Budget { monthlyUsd: number }
export interface Spend { totalUsd: number; byAccount: Record<string, number> }
export interface AdminUserRow {
  uid: string; email: string; monthlyUsd: number; spentUsd: number; remainingUsd: number;
}

const fns = getFunctions(app, "europe-west1");

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function loadBudget(uid: string): Promise<Budget | null> {
  const snap = await getDoc(doc(db, "users", uid, "billing", "budget"));
  return snap.exists() ? { monthlyUsd: (snap.data().monthlyUsd as number) ?? 0 } : null;
}

export async function loadSpend(uid: string, month: string): Promise<Spend> {
  const snap = await getDoc(doc(db, "users", uid, "billing", `spend_${month}`));
  const data = snap.data();
  return { totalUsd: (data?.totalUsd as number) ?? 0, byAccount: (data?.byAccount as Record<string, number>) ?? {} };
}

export async function callSetBudget(uid: string, monthlyUsd: number): Promise<void> {
  await httpsCallable(fns, "setBudget")({ uid, monthlyUsd });
}

export async function callListUsers(): Promise<AdminUserRow[] | null> {
  try {
    const res = await httpsCallable<unknown, { users: AdminUserRow[] }>(fns, "listUsers")({});
    return res.data.users;
  } catch (err) {
    if ((err as { code?: string }).code === "functions/permission-denied") return null;
    throw err;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add lib/billing.ts
git commit -m "feat(budget): client billing reads + admin callable wrappers"
```

---

## Task 8: User-facing cost panel from server spend

**Files:**
- Modify: `app/page.tsx` (`CostSummary`, and its data loading)
- Modify: `lib/store.ts` (drop the client `addUsage` write; keep `listUsage` read)

**Interfaces:**
- Consumes: `loadBudget`, `loadSpend`, `currentMonthKey` (Task 7); existing `listUsage` (read-only history).

- [ ] **Step 1: Remove the client write path**

In `lib/store.ts`, delete `addUsage` (usage is now written server-side inside the proxy). Keep `listUsage` for the history list. In `app/page.tsx`, remove the call site that computed `estimateCost` and called `addUsage` after a generation (around the current `estimatedUsd`/`rateNote` block); the proxy now records this.

- [ ] **Step 2: Rewrite `CostSummary` to read server spend**

```tsx
function CostSummary({ uid, accountId, accountNames }: {
  uid: string; accountId: string; accountNames: Record<string, string>;
}) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [spend, setSpend] = useState<Spend>({ totalUsd: 0, byAccount: {} });
  useEffect(() => {
    const month = currentMonthKey();
    loadBudget(uid).then(setBudget);
    loadSpend(uid, month).then(setSpend);
  }, [uid]);

  const cap = budget?.monthlyUsd ?? null;
  const spent = spend.totalUsd;
  const remaining = cap === null ? null : Math.max(0, cap - spent);
  const money = (v: number) => v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;

  return <Stack gap="sm">
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      <Card withBorder padding="sm"><Text size="xs" c="dimmed">Spent this month</Text><Text fw={700}>{money(spent)}</Text></Card>
      <Card withBorder padding="sm"><Text size="xs" c="dimmed">Monthly budget</Text><Text fw={700}>{cap === null ? "—" : money(cap)}</Text></Card>
      <Card withBorder padding="sm"><Text size="xs" c="dimmed">Remaining</Text><Text fw={700}>{remaining === null ? "—" : money(remaining)}</Text></Card>
    </SimpleGrid>
    <Text size="xs" c="dimmed">Recorded server-side per generation. Budget is set by the owner. Your Google Cloud invoice is authoritative.</Text>
    {Object.entries(spend.byAccount).map(([id, usd]) => (
      <Group key={id} justify="space-between" gap="xs">
        <Text size="sm">{accountNames[id] ?? id}</Text>
        <Text size="sm" fw={600}>{money(usd)}</Text>
      </Group>
    ))}
    {spent === 0 && <Text size="sm" c="dimmed">No tracked AI usage this month yet.</Text>}
  </Stack>;
}
```
Update the caller (the `Accordion.Panel` for `"costs"`) to pass `uid`, the active `accountId`, and an `accountNames` map from loaded accounts. Reload `loadSpend` after each successful generation (e.g. bump a dependency or call it in the generation success handler).

- [ ] **Step 3: Verify**

Run: `npm run build` (typecheck + export). Then `npm run preview`, generate once, and confirm the panel shows spent/budget/remaining and the per-account row updates.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx lib/store.ts
git commit -m "feat(budget): show server-recorded spend, budget, remaining"
```

---

## Task 9: Admin panel

**Files:**
- Modify: `app/page.tsx` (add `AdminPanel`, render it on load)

**Interfaces:**
- Consumes: `callListUsers`, `callSetBudget` (Task 7).

- [ ] **Step 1: Implement the panel**

```tsx
function AdminPanel() {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [visible, setVisible] = useState(false);
  const reload = () => callListUsers().then((r) => { setRows(r); setVisible(r !== null); });
  useEffect(() => { reload(); }, []);
  if (!visible || !rows) return null; // non-admins get null → panel hidden

  return <Card withBorder padding="md">
    <Text fw={700} mb="sm">User budgets (admin)</Text>
    <Stack gap="sm">
      {rows.map((u) => <AdminUserRowEditor key={u.uid} row={u} onSaved={reload} />)}
    </Stack>
  </Card>;
}

function AdminUserRowEditor({ row, onSaved }: { row: AdminUserRow; onSaved: () => void }) {
  const [value, setValue] = useState(String(row.monthlyUsd));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    setSaving(true);
    try { await callSetBudget(row.uid, n); onSaved(); } finally { setSaving(false); }
  };
  return <Group justify="space-between" gap="xs">
    <div>
      <Text size="sm">{row.email}</Text>
      <Text size="xs" c="dimmed">spent ${row.spentUsd.toFixed(2)} · remaining ${row.remainingUsd.toFixed(2)}</Text>
    </div>
    <Group gap="xs">
      <TextInput size="xs" w={90} value={value} onChange={(e) => setValue(e.currentTarget.value)} leftSection="$" />
      <Button size="xs" onClick={save} loading={saving}>Save</Button>
    </Group>
  </Group>;
}
```
Render `<AdminPanel />` somewhere in the signed-in layout (e.g. below the brand-brain accordion). Security is entirely server-side: `listUsers`/`setBudget` reject non-admins, so a normal user gets `null` and sees nothing even if they force-render the component.

- [ ] **Step 2: Verify**

`npm run preview`. Signed in as an `ADMIN_EMAILS` account: panel lists users, editing a budget persists and refreshes. Signed in as a non-admin: panel is absent (the `listUsers` call returns `null`).

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(budget): admin panel to view usage and set budgets"
```

---

## Task 10: Over-budget UX + deploy notes

**Files:**
- Modify: `app/page.tsx` (surface the block), `lib/gemini.ts` (map the callable error)
- Modify: `CLAUDE.md` (document the new secret + data model)

**Interfaces:**
- Consumes: the `resource-exhausted` `HttpsError` thrown by `generate` (Task 6).

- [ ] **Step 1: Surface a clear block message**

Where `generate` is invoked (`lib/gemini.ts`), let the callable error propagate; in the `app/page.tsx` catch that currently sets `error`, special-case it:
```ts
const code = (err as { code?: string }).code;
setError(code === "functions/resource-exhausted"
  ? "You've reached this month's budget. Ask the owner to raise it."
  : (err as Error).message);
```

- [ ] **Step 2: Document deploy**

In `CLAUDE.md` (Deploy section) add:
```sh
npx firebase functions:secrets:set ADMIN_EMAILS   # comma-separated owner email(s); who can set budgets
```
Note the new read-only `billing/*` + `usage/*` rules and that `firebase deploy --only firestore:rules` must ship them. Mind the existing artifact-cleanup-policy gotcha for the new callables (first deploy of a new function).

- [ ] **Step 3: Full build + test gate**

Run: `npm run build && npm test && npm --prefix functions run build`
Expected: build succeeds, all `node --test` pass.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx lib/gemini.ts CLAUDE.md
git commit -m "feat(budget): over-budget message + deploy docs"
```

- [ ] **Step 5: Deploy**

```bash
npx firebase functions:secrets:set ADMIN_EMAILS
npx firebase deploy --only firestore:rules
npm run deploy
# if the first deploy of setBudget/listUsers prompts the cleanup-policy gotcha:
npx firebase deploy --only hosting
npx firebase functions:artifacts:setpolicy
```
Confirm `release complete` / `Deploy complete!` in the log.

---

## Self-Review

**Spec coverage:**
- *Budgets per user, owner-only editable* → Tasks 2, 4 (read-only rules), 5 (`setBudget` gated by `ADMIN_EMAILS`). ✓
- *Safe / unbypassable* → Task 4 (billing + usage read-only), Task 6 (server pre-check), server-only writes via Admin SDK. ✓
- *Hard block on over-budget* → Task 6 (`resource-exhausted` before the Gemini call). ✓
- *Owner sees per-user usage* → Task 5 (`listUsers`), Task 9 (admin panel). ✓
- *Users see their own usage* → Task 7 (`loadBudget`/`loadSpend`), Task 8 (`CostSummary`). ✓
- *Per-account view* → `byAccount` on the spend doc (Task 3), displayed in Task 8. ✓
- *Monthly reset* → month-keyed spend docs `spend_{YYYY-MM}` (Tasks 1, 3); a new month starts at 0 with no cron. ✓

**Placeholder scan:** every code step contains real content; no TBD/TODO. Integration tasks that the repo's `node --test` cannot cover carry concrete emulator verification steps instead of fake unit tests — deliberate, matching the codebase's "pure logic only" test rule.

**Type consistency:** `UsageSnapshot`, `monthKey`, `costUsd`, `resolveMonthlyUsd`, `isOverBudget`, `remainingUsd`, `readBudgetState`, `recordSpend`, `Budget`, `Spend`, `AdminUserRow` are named identically across producer and consumer tasks. Spend doc id is `spend_{YYYY-MM}` everywhere; budget doc is `billing/budget` everywhere.

**Known ceilings (intentional):**
- Check-before/record-after → one call can overshoot the cap (Task 2 comment).
- Concurrent calls can both pass the pre-check → bounded overage (Task 6 comment).
- Server rate table duplicates `lib/cost.ts` → hand-synced (Task 1 note).
- `listUsers` enumerates up to 1000 auth users in one page → fine for an allowlisted app; paginate only if the allowlist ever grows past that.
