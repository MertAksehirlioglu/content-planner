# Weekly Content Planner

Store a brand once, submit a weekly brief, approve a strategy, get production-ready Instagram
and LinkedIn posts — captions, hashtags, creative briefs, and generated images. Company and
founder read as different voices. The app does not post anything.

Next.js (App Router) + TypeScript + Mantine, statically exported to Firebase Hosting. Two Cloud
Functions: a sign-in gatekeeper and a metered Gemini proxy.

## Setting up your own

Provisioning is Terraform, not console clicking — see **[infra/README.md](./infra/README.md)**.
You need Node.js 22, Terraform 1.5+, the Google Cloud CLI, a GCP project with billing enabled,
and a Gemini Developer API key. Authenticate Terraform first:

```sh
gcloud auth login
gcloud auth application-default login
```

Then:

```sh
gcloud projects create my-content-planner
gcloud billing projects link my-content-planner --billing-account=<id>   # Blaze is required

cd infra && cp terraform.tfvars.example terraform.tfvars   # project_id, emails, gemini key
terraform init && terraform apply

cd ..
npm ci && npm --prefix functions ci
terraform -chdir=infra output -raw env_local > .env.local
npx firebase use my-content-planner
npm run deploy
```

Two things Terraform can't create: the Gemini API key (AI Studio has no API) and the Google
sign-in OAuth consent screen. `terraform output manual_steps` tells you which are outstanding.
Your real `terraform.tfvars`, Terraform state, `.env.local`, `.firebaserc`, and common service
account key filenames are ignored. Terraform state still contains secret values in plaintext,
so keep it private and encrypted; never upload it as an issue attachment or CI artifact.

## Run

```sh
npm run dev        # http://localhost:8420, hot reload
npm run preview    # built site against the Firebase emulators (Hosting, gatekeeper, Firestore)
```

Both need `.env.local` — the app fails fast with an actionable message if it's missing. `npm run
dev` also needs a signed-in Google account on the allowlist before it will generate anything.

## Check

```sh
npm test          # node --test: prompts, parsers, profile, export, allowlist, cost, budget. No network.
npm run build     # next build → static export in out/ (also typechecks the web app)
npm --prefix functions run build    # typechecks the functions
npm --prefix functions run test:rules   # firestore.rules against the emulator (needs JDK 21+)
```

## How it works

- `lib/plan.ts` — the system prompt, prompt assembly, and the parsers that validate untrusted
  model JSON. Pure: no SDK imports, so `npm test` runs it with no build step.
- `lib/gemini.ts` / `lib/image.ts` — response schemas and model ids. Both call the server proxy
  through `lib/generate-client.ts`; the browser never talks to Gemini directly.
- `functions/src/generate.ts` — the proxy. Holds the `GEMINI_API_KEY`, checks the caller's
  monthly budget before spending, meters the call after, and records it. Deliberately dumb:
  prompt assembly and parsing stay client-side.
- `lib/image-prompt.ts` / `lib/image-layout.ts` — the model is forbidden from rendering
  typography; headline and supporting text are drawn afterwards with Canvas, so text is always
  sharp and correct.
- `lib/store.ts` — the only Firestore module. Accounts and their items live under `users/{uid}`,
  owner-scoped by `firestore.rules`.
- `functions/src/index.ts` — a `beforeUserSignedIn` blocking function that refuses any email
  outside `ALLOWED_EMAILS`. It never sees a plan request.
- `app/page.tsx` — the UI and the sign-in gate.

Access control is three Firebase mechanisms, not app code: **App Check** proves the request came
from this app, the **callables reject unauthenticated requests**, and the **gatekeeper** means
only allowlisted emails can obtain a session at all. Budgets and spend counters under
`users/{uid}/billing/*` are client-read-only — only the Admin SDK writes them, so a user can
neither raise their own cap nor reset their counter. See [CLAUDE.md](./CLAUDE.md).

## Deploy

Every push to `main` deploys — `.github/workflows/deploy.yml` builds, runs `npm test`, then
deploys hosting + functions + Firestore rules. It reads the project id and the public web config
from repository variables; the header of that file lists them.

Changing who has access = update `allowed_emails` in `terraform.tfvars`, apply, redeploy the
functions. No client change.

## Not built yet

Auto-posting (Instagram Graph / LinkedIn APIs), scheduling, tier gating. See
[ROADMAP.md](./ROADMAP.md) for open work, and [docs/history/](./docs/history/) for the
original design docs (kept for their reasoning, not current).

## Security

The security model — App Check, the callable auth check, the sign-in gatekeeper, and the
owner-scoped Firestore rules — is written up in [SECURITY.md](./SECURITY.md), along with what's
in scope, what's knowingly accepted, and how to report something privately.

Before changing a fork to public, run `gitleaks git --redact .` against the full history and
`npm audit` in both the root and `functions/`. Rotate any credential that ever appeared in a
commit even after rewriting it: history removal does not revoke a copied key.

## License

MIT — see [LICENSE](./LICENSE).
