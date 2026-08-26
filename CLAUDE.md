# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Weekly Content Planner: store a brand brain once, submit a structured weekly brief, approve
a cross-channel strategy, then generate production-ready Instagram and LinkedIn content for
company and founder voices. Multiple businesses ("accounts") are stored per user; workflow
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
chokepoint (the seam the per-user budget layer meters). Two Cloud Functions now: the
sign-in `gatekeeper` and the `generate` proxy.

The proxy is deliberately dumb — an App-Check-gated, authenticated *metered pipe*. Prompt
assembly (`buildPrompt`), the response schemas, and all parsing stay in the pure client
modules; the server only forwards `{ parts, systemInstruction, generationConfig }` to Gemini
and returns `{ text, inlineData?, usageMetadata, model }`. `lib/plan.ts` stays pure/offline-
testable (no `firebase/*` import).

Account state (business profiles + their saved/backlog `items`) lives in **Firestore**,
owner-scoped by `uid` via `firestore.rules`. The browser reads/writes it directly through
`lib/store.ts`.

**Access control is not in the app code** — it's three Firebase-layer mechanisms working
together, and you must understand all three to reason about security:

1. **App Check** (reCAPTCHA Enterprise, set up in `lib/firebase.ts`) — proves a request
   comes from this app; `httpsCallable` attaches its token to every `generate` call, which
   is registered with `enforceAppCheck: true`.
2. **Auth on the callable** — `generate` rejects any unauthenticated request; combined with
   the gatekeeper, only allowlisted signed-in users reach Gemini.
3. **`gatekeeper`** (`functions/src/index.ts`, a `beforeUserSignedIn` blocking function) —
   refuses any email outside `ALLOWED_EMAILS` *at sign-in*, so a valid session only ever
   exists for an allowlisted account.

Net effect: Gemini answers only signed-in users from the real app (1+2), and only
allowlisted emails can obtain a session (3). Changing who has access = update the
`ALLOWED_EMAILS` secret and redeploy the function; no client change.

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
- `functions/src/generate.ts` — the server proxy (`onCall`, `europe-west1`,
  `enforceAppCheck: true`). Calls Gemini through the `@google/genai` SDK with the
  `GEMINI_API_KEY` secret; never parses prompts. Validates `model` against
  `BILLABLE_MODELS` and `accountId` against `isValidAccountId` before spending anything.
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
- `lib/store.ts` — Firestore CRUD for accounts and their `items` (backlog + production
  workflow). The only module importing `firebase/firestore`. Legacy profiles and `used`
  statuses are normalized on read.
- `firestore.rules` — every doc under `users/{uid}` locked to its owner.
- `app/page.tsx` — the entire UI and the sign-in gate. Brand brain, weekly brief, strategy
  approval, content packages, scoped transforms, and workflow controls live here. Accounts
  + items load from Firestore
  on sign-in; only *which* account is active is kept in `localStorage`. A legacy
  `planner.profile` (from the pre-Firestore version) is migrated into a "Default" account on
  first load.

### Constraints that bite

- **Static export runs `lib/firebase.ts` under Node at build time.** Any browser-only
  init (App Check) must be `typeof window !== "undefined"` guarded or the build crashes.
- **Function region is `europe-west1`** — set on the gatekeeper and must match if you add
  functions.
- **The `functions/` package is ESM** (`"type": "module"`, `moduleResolution: nodenext`).
  Relative imports in `src/*.ts` need explicit `.js` extensions (e.g. `./allowlist.js`);
  test files keep `.ts` for `node --test` type-stripping. This lets ESM-only deps like
  `@google/genai` be imported statically.
- **Mantine 9 requires Next 16+** (it imports React 19.2's `useEffectEvent`, which Next 15
  doesn't vendor).

## Deploy

Provisioning lives in `infra/` (Terraform) — see `infra/README.md`. The project id is not
hardcoded anywhere: the web config comes from `.env.local` (generated by
`terraform -chdir=infra output -raw env_local`) and CI reads it from repository variables.

**CD: every push to `main` deploys via
`.github/workflows/deploy.yml`** (build → `npm test` → `firebase deploy` of hosting +
functions + firestore rules). One-time setup: add a deploy service account's JSON key as
the `FIREBASE_SERVICE_ACCOUNT` GitHub secret (roles + shortcut documented in the workflow
file). `ALLOWED_EMAILS` lives in Secret Manager, not GitHub.

Requires the Blaze plan, a Gemini Developer API key (the `GEMINI_API_KEY` secret, used by the
`generate` proxy), App Check registered, Identity Platform enabled (for the blocking
function), and **Firestore enabled** (for account state).

Manual deploy from your machine:

```sh
terraform -chdir=infra apply                        # secrets, App Check, Firestore, auth config
terraform -chdir=infra output -raw env_local > .env.local
npx firebase deploy --only firestore:rules          # publish least-privilege rules (billing/usage read-only)
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

`npm run preview` also starts the Firestore emulator (see `firebase.json` → `emulators`),
so accounts/items work locally without touching production data.

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
for f in generate setbudget listusers; do
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
