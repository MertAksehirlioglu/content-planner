# Contributing

This is a personal project shared in case it's useful. Issues and PRs are welcome but may sit
for a while — it isn't staffed. For anything security-related, use
[SECURITY.md](./SECURITY.md) instead of a public issue.

## Running it

You need your own Firebase project — there is no shared instance. See
[infra/README.md](./infra/README.md); `terraform apply` does nearly all of it.

```sh
npm ci && npm --prefix functions ci
terraform -chdir=infra output -raw env_local > .env.local   # or copy .env.example
npm run dev
```

## Before you open a PR

```sh
npm test                            # pure logic, no network, no emulator
npm run build                       # also typechecks the web app
npm --prefix functions run build    # typechecks the functions
```

CI runs those plus two emulator suites (`test:rules`, `test:budget`) on every PR. Those need
**JDK 21+** locally — the Firestore emulator refuses anything older — so it's fine to let CI run
them if your machine has an older JDK.

## House style

The repo has opinions, and they're in [CLAUDE.md](./CLAUDE.md). The ones that bite:

- **Keep `lib/plan.ts` and the other pure modules free of SDK imports.** `npm test` runs them
  with Node's type-stripping and no build step; one `firebase/*` import breaks the whole suite.
  Intra-repo imports in tested files keep their `.ts` extension.
- **Rates live in `functions/src/cost.ts` only.** `BILLABLE_MODELS` and the rate table are
  deliberately the same list: a model with no rate bills $0, and a $0 bill never advances the
  budget. `lib/cost.ts` is display-only — don't give it a second copy of the rates.
- **Don't let Terraform manage `blocking_functions`.** `firebase deploy` owns that field; see
  the comment in `infra/auth.tf` for what breaks if you "clean it up".
- Anything crossing a trust boundary gets validated where it arrives, not where it's used.
