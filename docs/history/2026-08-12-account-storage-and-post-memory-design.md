# Account Storage, Post Memory & Backlog — Design

**Date:** 2026-08-12
**Status:** Approved design, pre-implementation
**Scope:** One implementation plan.

## Problem

The planner stores a single business profile in `localStorage` and remembers nothing
between generations. The owner re-describes context implicitly, can't manage more than one
business, and the model has no idea what was already posted — so it repeats itself. There's
also no place to park an idea that's good but not for this week.

## Goals

1. **Accounts** — store multiple business profiles, switch between them, no re-typing.
2. **Post memory / dedup** — remember posts the owner actually committed to and feed them
   back so future plans don't duplicate them.
3. **Backlog** — a list of future post ideas (out of this week) that generation can draw from.

## Non-goals (this round)

- **Per-platform variants.** Instagram only. A `platform` field is stored so LinkedIn etc.
  can be added later without a migration, but there is no platform UI.
- **The CLI import tool.** Out of scope, but history lives in Firestore specifically so a
  future CLI/function can bulk-write to the same `items` collection with zero rework.
- **A history/analytics browsing view.** Kept posts are stored and used for dedup; a UI to
  browse them is a later nicety.
- **Semantic dedup.** See the ponytail ceiling under Prompt changes.

## Decisions (locked with the user)

- Storage: **Firestore**, scoped to the signed-in user. This is what makes the CLI goal
  possible — a CLI can't read a browser's `localStorage`.
- Platforms: **Instagram only** now; keep a `platform` seam.
- Post memory: **explicit Keep** — generated plans are drafts; only posts the owner marks
  enter history. Keeps dedup clean and is compatible with the CLI later bulk-importing
  published posts into the same collection.
- Backlog: **park generated posts + manual add**; generation reads the backlog as candidate
  material.
- Account UI: **switcher + add + rename/delete** (full management).

## Architecture

Still a static site; the model call still goes **browser → Gemini via Firebase AI Logic**.
What changes: account state now lives in **Firestore** instead of `localStorage`, read and
written from the browser under the signed-in user's `uid`. The `gatekeeper` blocking
function and the three access-control mechanisms are unchanged — Firestore access is locked
to the owner's own `uid` on top of them.

### Firestore data model

```
users/{uid}/accounts/{accountId}          → Account (minus id)
users/{uid}/accounts/{accountId}/items/*  → Item (minus id)
```

```ts
interface Account {
  id: string;              // Firestore doc id (not stored in the doc body)
  name: string;            // e.g. "visionOS studio"
  profile: Profile;        // existing shape: business, audience, tone, frequency, categories, allCategories
  platform: "instagram";   // seam for later; always "instagram" this round
  createdAt: number;
}

interface Item {
  id: string;
  status: "used" | "backlog";
  summary: string;         // short line used in prompts and list display; always present
  post?: Post;             // full generated Post when it came from a plan; absent for a typed idea
  createdAt: number;
}
```

One `items` collection, not separate history/backlog collections: a backlog idea is just an
item that hasn't been used yet. Using a backlog item = flip `status` to `used`. Prompts only
ever read `summary`, so the two item shapes (with/without `post`) are handled uniformly.

### Module boundaries

- **`lib/firebase.ts`** — add `getFirestore(app)` export. Unchanged otherwise.
- **`lib/store.ts`** (new) — the only Firestore-touching module. CRUD for accounts and
  items, all scoped by the current `uid`:
  - `listAccounts(uid)`, `createAccount(uid, name)`, `updateAccountProfile(uid, id, profile)`,
    `renameAccount(uid, id, name)`, `deleteAccount(uid, id)`
  - `listItems(uid, accountId)`, `addItem(uid, accountId, item)`, `setItemStatus(...)`,
    `deleteItem(...)`
  - Keeps `lib/plan.ts` free of SDK imports so `node --test` still runs offline.
- **`lib/plan.ts`** — `PlanRequest` gains `recent_posts?: unknown` and `backlog?: unknown`
  (both untrusted string arrays). `buildPrompt` appends two optional sections. Stays pure;
  gets unit tests. Existing behaviour (fresh plan + revision path) unchanged.
- **`lib/gemini.ts`** — passes `recent_posts` and `backlog` through to `buildPrompt`. No
  schema change (these are input, not output).
- **`app/page.tsx`** — account switcher + add/rename/delete; the business form edits the
  selected account and saves to Firestore on change; Keep / Save-to-backlog buttons on each
  generated post card; a backlog panel (list + add-idea input + remove + "use").
- **`firestore.rules`** (new) + `firebase.json` — every doc locked to its owner:
  `allow read, write: if request.auth != null && request.auth.uid == uid`.

## Prompt changes (`lib/plan.ts`)

`buildPrompt` appends, when present:

- `Already posted (do not repeat these): <summary>; <summary>; …` — from the account's
  `used` items, most recent first, capped at ~30.
- `Backlog ideas you may draw from this week: <summary>; …` — from `backlog` items.

Both are plain text of `summary` fields, sanitised and length-capped like existing fields.

> **ponytail ceiling:** dedup is naive — the last ~30 kept summaries dropped into the prompt
> as text, no embeddings. Correct for a POC. Upgrade path if the list outgrows the context
> window: embed summaries + nearest-neighbour filter before injecting. Named here so the
> simplicity reads as intent.

## Generation flow

1. Active account's `profile` + `this_week` are collected as today.
2. `store.listItems` supplies recent `used` summaries → `recent_posts`, and `backlog`
   summaries → `backlog`.
3. `generatePlan` runs as today; the plan renders as drafts.
4. Per post card: **Keep** → `addItem(status:"used")`; **Save to backlog** →
   `addItem(status:"backlog")`. Both derive `summary` from the post (caption first line).
5. Backlog panel: type an idea → `addItem(status:"backlog", summary)` (no `post`); "use" an
   item → `setItemStatus("used")`; remove → `deleteItem`.

## Migration

On first load with a signed-in user and zero accounts, if a legacy `planner.profile` exists
in `localStorage`, create a "default" account from it. Otherwise create an empty "default"
account so there's always an active one. Legacy key is read once and left in place (no
destructive cleanup).

## Error handling

- All `store.ts` calls are `async` and wrapped at the call site; Firestore failures surface
  in the existing red `Alert`, never silently swallowed.
- Firestore rules fail closed: no `uid` match → denied.
- `parsePlan` and the untrusted-input handling in `buildPrompt` are unchanged; new prompt
  inputs go through the same `text()` sanitiser and length caps.

## Testing

- `lib/plan.test.ts` — new cases: `recent_posts` and `backlog` appear in the prompt when
  present and are omitted when empty; existing fresh/revision cases still pass. Pure, offline.
- `lib/store.ts` is SDK/network-bound, so it is **not** unit-tested under `node --test`
  (that would break the offline test rule). Verified manually against the Firestore emulator
  via `npm run preview`.

## Deploy / setup deltas

- Enable **Firestore** in the Firebase console (project `content-planner-mert`).
- Add `firestore` to `firebase.json` and deploy rules: `npx firebase deploy --only firestore:rules`.
- The emulator suite (`npm run preview`) should include Firestore for local verification.
- Update **CLAUDE.md**: the "no backend data / no database" architecture note becomes
  "Firestore holds account state (accounts + items), owner-scoped by `uid`; the model call
  still goes browser → Gemini."
