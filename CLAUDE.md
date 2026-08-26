# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Weekly Content Planner: store a brand brain once, submit a structured weekly brief, approve
a cross-channel strategy, then generate production-ready Instagram and LinkedIn content for
company and founder voices. A brand is a **shared workspace**: several signed-in users can be
members of one, and they all see the same profile, items, backlog and weeks. Budgets are
deliberately *not* shared — every member spends against their own monthly cap. Workflow
history and a backlog feed future generation and deduplication. The app does not post content.
Next.js (App Router) + TypeScript + Mantine, statically exported.

## Workflow

Solo POC — push straight to `main`, no draft PRs. Every push to `main` auto-deploys via
GitHub Actions (see [Deploy](#deploy)).

## Commands

```sh
npm install && npm --prefix functions install   # two package.json roots: ./ and functions/

npm test                        # node --test, no network, no framework — pure logic only
node --test lib/plan.test.ts    # a single test file
node --test --test-name-pattern="allowlist"   # a single test by name

# Emulator suites, outside `npm test` (they import SDKs). Need a JDK 21+ on PATH.
npm --prefix functions run test:rules      # firestore.rules: membership, billing, legacy path
npm --prefix functions run test:budget     # the reserve/settle transaction under concurrency
npm --prefix functions run test:migrate    # the one-shot workspace migration

npm run build                   # next build → static export in out/ (also typechecks the web app)
                                # postbuild runs scripts/check-build.mjs: fails if the Firebase
                                # web config is a placeholder or never reached the bundle
npm --prefix functions run build   # tsc, typechecks the Cloud Function

npm run dev        # Next only, hot reload, http://localhost:8420 — no sign-in gate backend
npm run preview    # build + firebase emulators (Hosting + the blocking function)
npm run deploy     # build + firebase deploy   (see the deploy gotcha below)
```

Tests run on Node's native type-stripping, so intra-repo imports keep their `.ts`
extension (e.g. `import … from "./plan.ts"`). Keep anything under test free of SDK/network
imports or `npm test` breaks.

## Architecture

Static site on Firebase Hosting. The page is prerendered to `out/`; the model call goes
**from the browser through the `generate` Cloud Function to Gemini** (via the `@google/genai`
SDK). The browser no longer talks to Gemini directly — the
`GEMINI_API_KEY` lives only on the server, and every generation flows through that one
chokepoint (the seam the per-user budget layer meters). The deployed functions are the sign-in
`gatekeeper`, the `generate` proxy, the admin pair (`setBudget`, `listUsers`) and the workspace
trio (`createWorkspace`, `addMember`, `removeMember`) — all in `europe-west1`.

The proxy is deliberately dumb — an App-Check-gated, authenticated *metered pipe*. Prompt
assembly (`buildPrompt`), the response schemas, and all parsing stay in the pure client
modules; the server only forwards `{ parts, systemInstruction, generationConfig }` to Gemini
and returns `{ text, inlineData?, usageMetadata, model }`. `lib/plan.ts` stays pure/offline-
testable (no `firebase/*` import).

Brand state (business profiles + their saved/backlog `items`, weeks and usage log) lives in
**Firestore** at top-level `workspaces/{workspaceId}`, scoped to the uids listed in that
workspace's `members/` subcollection via `firestore.rules`. The browser reads/writes it
directly through `lib/store.ts`. Budget and spend stayed at `users/{uid}/billing/*`, keyed by
`request.auth.uid` — **shared brand, individual wallets**, which is what designs out the whole
class of "forge a workspace id, drain someone else's budget" attacks.

**Access control is not in the app code** — it's four Firebase-layer mechanisms working
together, and you must understand all four to reason about security:

1. **App Check** (reCAPTCHA Enterprise, set up in `lib/firebase.ts`) — proves a request
   comes from this app; `httpsCallable` attaches its token to every `generate` call, which
   is registered with `enforceAppCheck: true`.
2. **Auth on the callable** — `generate` rejects any unauthenticated request; combined with
   the gatekeeper, only allowlisted signed-in users reach Gemini.
3. **`gatekeeper`** (`functions/src/index.ts`, a `beforeUserSignedIn` blocking function) —
   refuses any email outside `ALLOWED_EMAILS` *at sign-in*, so a valid session only ever
   exists for an allowlisted account.
4. **Workspace membership** — `firestore.rules` grant a workspace's data only to uids with a
   `members/{uid}` document, and deny every *client* write to `members/*`; the membership
   callables (Admin SDK) are the only writers. Rules govern the browser's path, not the Admin
   SDK path the proxy takes, so `generate` re-checks membership itself
   (`functions/src/workspace-store.ts` → `assertMember`) before it reserves budget or writes a
   usage event.

Net effect: Gemini answers only signed-in users from the real app (1+2), only allowlisted
emails can obtain a session (3), and a session only reaches the brands it was added to (4).
Changing who has access *at all* = update the `ALLOWED_EMAILS` secret and redeploy the
function; changing who sees a *brand* = add them in the app's members panel. The two are
separate: a member who is not on `ALLOWED_EMAILS` can never sign in to use their membership.

### Where things live

- `lib/plan.ts` — strategy/plan types, prompt assembly, and response parsing. Pure: no SDK,
  so it stays unit-testable. Parsers validate untrusted model JSON. `buildPrompt` handles
  strategy, production, revision, and scoped transformation modes.
- `lib/gemini.ts` — text generation. Builds the plain-JSON Gemini `responseSchema` and calls
  the `generate` proxy (via `lib/generate-client.ts`), then parses the returned text. The
  model id (`gemini-3.6-flash`) is the constant to change for quality/cost. Also holds
  `deriveStyleRule`, a fire-and-forget economy-model call made after a revision.
- `lib/generate-client.ts` — the one `httpsCallable(functions, "generate")` wrapper. Shared
  by `lib/gemini.ts` and `lib/image.ts`; returns `{ text, inlineData?, usageMetadata, model }`.
  `workspaceId` is a **required** field on every request.
- `functions/src/generate.ts` — the server proxy (`onCall`, `europe-west1`,
  `enforceAppCheck: true`). Calls Gemini through the `@google/genai` SDK with the
  `GEMINI_API_KEY` secret; never parses prompts. Validates `model` against
  `BILLABLE_MODELS`, then calls `assertMember` — before `reserveSpend`, so a rejected
  non-member never leaves a budget hold behind.
- `functions/src/membership.ts` — the pure membership predicates (`isMember`,
  `canManageMembers`, `canRemoveMember`). Fails closed; the owner passes even without a member
  document so a deleted one can't strand a brand. Tested offline.
- `functions/src/workspace-store.ts` — the Admin SDK half: `assertMember`, and the batched
  writes that create a workspace together with its owner's member document.
- `functions/src/workspace-api.ts` — `createWorkspace` / `addMember` / `removeMember`
  callables. Owner-only for the membership pair; `addMember` resolves an email to a uid, which
  is the reason this is a callable and not a client write.
- `functions/src/cost.ts` — **the only** model rate table, and the allowlist of callable
  models, deliberately the same list: a model with no rate bills $0, and a $0 bill never
  advances the budget. `lib/cost.ts` is display-only (usage normalization plus a pre-flight
  image estimate) and must not grow a second copy of the rates.
- `lib/rules.ts` — learned editorial rules. After a revision lands, one call asks whether the
  feedback expressed a *durable, post-independent* preference; anything that survives is stored
  on the profile as `styleRules` and injected into every later prompt. Pure, so it's tested
  offline. Deliberately biased toward returning nothing — a wrong standing rule poisons every
  future plan, and the owner can delete rules in the brand-brain panel.
- `lib/export.ts` — browser-side Markdown/JSON production briefs and ready-to-upload 1080×1350
  PNG slides.
- `lib/image.ts` — Gemini image generation. The UI must show an editable prompt first and
  make no image call until explicit confirmation; generated images allow at most 3 retries.
  Downloads decode the original model bytes directly and must never use canvas recompression.
  The entry point is visible for every visual post (single image, carousel, or reel), not
  only posts the planner happened to classify as `ai_image`. Carousels must create one
  editable prompt and one model image per slide; never send a multi-slide brief as one image.
- `lib/firebase.ts` — Firebase app init + App Check (browser-only, `typeof window`
  guarded) + auth. The web config and reCAPTCHA site key are **public identifiers read from
  `NEXT_PUBLIC_*`**, not secrets — they live in the environment so a fork points at its own
  project, not so they stay hidden. Missing values throw at build with a fix-it message.
- `functions/src/allowlist.ts` — exact, case-insensitive email match; fails closed (empty
  list allows nobody). Shared by the gatekeeper; has its own test.
- `lib/store.ts` — Firestore CRUD for workspaces, their `members`, `items` (backlog +
  production workflow), `weeks` and `usage`. Legacy profiles and `used` statuses are normalized
  on read. `listWorkspaces` is a `collectionGroup("members").where("uid","==",…)` query — the
  filter is on the *field* because that is what rules can prove a query against, and it needs
  the collection-group index in `firestore.indexes.json`. `lib/media.ts` (image chunks under
  `weeks/`) and `lib/billing.ts` (per-user spend) are the other two Firestore importers.
- `firestore.rules` — `workspaces/{id}` and its `items`/`weeks` open to members; `members/*`
  and `usage/*` client-read-only; everything under `users/{uid}` locked to that user, with
  `billing/*` client-read-only. The legacy `users/{uid}/accounts/**` block is still there
  deliberately — see Migration below.
- `app/page.tsx` — the entire UI and the sign-in gate. Brand brain, weekly brief, strategy
  approval, content packages, scoped transforms, and workflow controls live here. Workspaces
  + items load from Firestore on sign-in via `hooks/useWorkspaces.ts`; only *which* workspace
  is active is kept in `localStorage` (under the old `planner.activeAccount` key, because
  workspace ids *are* the old account ids). A legacy `planner.profile` (from the pre-Firestore
  version) is migrated into a "Default" workspace on first load.
- `components/MembersPanel.tsx` — the members roster and the owner-only add/remove controls,
  in the Brand tab. Also where the "budgets are per-person, not per-brand" warning lives, so a
  member is not surprised when their own cap runs out while a colleague's has room.

### Constraints that bite

- **Static export runs `lib/firebase.ts` under Node at build time.** Any browser-only
  init (App Check) must be `typeof window !== "undefined"` guarded or the build crashes.
- **Function region is `europe-west1`** — set on the gatekeeper and must match if you add
  functions.
- **`workspace` means two different things.** `WeekWorkspace` / `workspaceIdentity` in
  `lib/week.ts` are about one *week's* editing state; `Workspace` in `lib/store.ts` is the
  shared brand. The UI tab state in `app/page.tsx` is `tab`, not `workspace`, for this reason.
- **The `functions/` package is ESM** (`"type": "module"`, `moduleResolution: nodenext`).
  Relative imports in `src/*.ts` need explicit `.js` extensions (e.g. `./allowlist.js`);
  test files keep `.ts` for `node --test` type-stripping. This lets ESM-only deps like
  `@google/genai` be imported statically.
- **Mantine 9 requires Next 16+** (it imports React 19.2's `useEffectEvent`, which Next 15
  doesn't vendor).

## Migration to shared workspaces

Brand data moved from `users/{uid}/accounts/{accountId}/**` to `workspaces/{accountId}/**` —
the id is carried over verbatim, which is why `spend.byAccount`, the `?company=` URL param and
the stored active-workspace id all still resolve. There is **no read-time fallback** in
`lib/store.ts`: a fallback would split reads and writes across two locations forever. Instead:

```sh
FIREBASE_PROJECT_ID=<project> node functions/scripts/migrate-workspaces.mjs           # dry run
FIREBASE_PROJECT_ID=<project> node functions/scripts/migrate-workspaces.mjs --apply
```

It copies only — nothing is deleted — so the old tree is the rollback. Run it **before** the
push that deploys the new client, or signed-in users briefly see an empty workspace list. It
is idempotent (an existing workspace is skipped unless `--force`), so a partial run is safe to
repeat. Budgets need no migration; that is the point of the design.

Once verified in production, delete the legacy `users/{uid}/accounts/**` block from
`firestore.rules` and the old documents. Until then that block stays writable so a rollback
works.

## Deploy

Provisioning lives in `infra/` (Terraform) — see `infra/README.md`. The project id is not
hardcoded anywhere: the web config comes from `.env.local` (generated by
`terraform -chdir=infra output -raw env_local`) and CI reads it from repository variables.

**CD: every push to `main` deploys via
`.github/workflows/deploy.yml`** (build → `npm test` → `firebase deploy` of hosting +
functions + firestore rules **and indexes** — `listWorkspaces` needs the collection-group
index in `firestore.indexes.json` or it fails at runtime with a "requires an index" error). One-time setup: add a deploy service account's JSON key as
the `FIREBASE_SERVICE_ACCOUNT` GitHub secret (roles + shortcut documented in the workflow
file). `ALLOWED_EMAILS` lives in Secret Manager, not GitHub.

Requires the Blaze plan, a Gemini Developer API key (the `GEMINI_API_KEY` secret, used by the
`generate` proxy), App Check registered, Identity Platform enabled (for the blocking
function), and **Firestore enabled** (for account state).

Manual deploy from your machine:

```sh
terraform -chdir=infra apply                        # secrets, App Check, Firestore, auth config
terraform -chdir=infra output -raw env_local > .env.local
npx firebase deploy --only firestore:rules,firestore:indexes   # least-privilege rules + the members index
npm run deploy
```

The three secrets (`ALLOWED_EMAILS`, `ADMIN_EMAILS`, `GEMINI_API_KEY`) are Terraform-managed —
rotate by editing `infra/terraform.tfvars` and re-applying, then redeploy so the functions bind
the new version. Don't `functions:secrets:set` them by hand; Terraform will overwrite it.

Per-user budgets: the `generate` proxy meters every call and hard-blocks (a
`resource-exhausted` error) once a user's month-to-date spend reaches their cap. Budgets
and the spend counter live under `users/{uid}/billing/*` and are **client-read-only** —
only the Admin SDK (the proxy + the `setBudget`/`listUsers` admin callables) writes them,
so a user can neither raise their own cap nor reset their counter. Change who is admin =
update `ADMIN_EMAILS` and redeploy; a signed-in user with no budget doc gets a $5/mo default.

Budgets stay per-user even for a *shared* workspace: colleagues on one brand each have their
own cap, one exhausting theirs never blocks the other, and the spend document's `byAccount`
field is keyed by workspace id so it still shows where a person's own money went.

`npm run preview` also starts the Firestore emulator (see `firebase.json` → `emulators`),
so workspaces/items work locally without touching production data.

**Deploy gotcha:** on the first deploy of a new/changed function, Firebase prompts about an
artifact **cleanup policy** and `firebase deploy` exits non-zero *after* uploading the
hosting files but *before releasing* the hosting version — so the site silently stays on
the old version (root serves 404 if it was the first release). Finalize with:

```sh
npx firebase deploy --only hosting        # releases the already-uploaded version
npx firebase functions:artifacts:setpolicy   # set the cleanup policy so it stops recurring
```

Confirm a release actually happened by checking the log for `release complete` /
`Deploy complete!`, not just `file upload complete`.

Note `functions:artifacts:setpolicy` defaults to `us-central1`; this project's functions are
in `europe-west1`, so pass `--location europe-west1` or it reports the repository as missing.

**Deploy gotcha — the invoker binding disappears.** Callable functions must be publicly
*invocable* (`allUsers` + `roles/run.invoker` on the Cloud Run service) for the browser
callable protocol to work at all: a browser cannot present a Google IAM identity. A redeploy
can silently drop that binding. The symptom is misleading — the browser reports

```
blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

but it is not a CORS bug. Cloud Run rejects the preflight with a plain 403 HTML page from
Google Frontend, which carries no CORS headers; the function is never reached. Restore it
(**the Cloud Run service names are lowercased** — `setbudget`, not `setBudget`):

```sh
for f in generate setbudget listusers createworkspace addmember removemember; do
  gcloud run services add-iam-policy-binding $f \
    --region=europe-west1 --project="$FIREBASE_PROJECT_ID" \
    --member=allUsers --role=roles/run.invoker
done
```

Check with `gcloud run services get-iam-policy generate --region=europe-west1`. A healthy
preflight returns `204` with `access-control-allow-origin`; a healthy anonymous POST returns
`401`. This is not a security downgrade: access is enforced inside the function by App Check,
the auth check, the gatekeeper allowlist, and the budget cap — `allUsers` grants the right to
*reach* the endpoint and be rejected, not to use it. `maxInstances` bounds what those
rejections can cost.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
