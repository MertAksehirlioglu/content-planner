# Roadmap

Open work for the Weekly Content Planner. See [CLAUDE.md](./CLAUDE.md) for how the thing is
built and [infra/README.md](./infra/README.md) for provisioning.

This is a single-operator tool: you run your own instance, and `ALLOWED_EMAILS` decides who can
sign in. Items below are written for that reader — "you" is whoever deployed it.

## Shipped since this file was first written

The original roadmap planned a server-side proxy for per-user limits. That exists now, so most
of what used to be here is done:

- **Server-side model calls.** `functions/src/generate.ts` is a callable with
  `enforceAppCheck: true` that rejects unauthenticated requests and holds the `GEMINI_API_KEY`.
  The browser no longer talks to Gemini.
- **Per-user budgets.** Month-to-date spend is metered server-side and blocks with
  `resource-exhausted` at the cap. Counters live under `users/{uid}/billing/*` and are
  client-read-only, so a user can neither raise their cap nor reset their spend.
- **Model allowlist.** The proxy refuses any model without a rate, so an unmetered call can't
  slip past the budget.
- **Project-level spend backstop.** `infra/budget.tf` provisions a billing budget.
- **Concurrent budget holds.** The proxy reserves spend in a Firestore transaction before the
  model call and settles the exact cost afterwards, so concurrent calls serialize at the cap.

## Open

### Tests around the UI data layer

`npm test` covers the pure modules (prompts, parsers, profile, export, cost, budget, allowlist).
Nothing covers `lib/store.ts`, `lib/media.ts`, `lib/image.ts`, or `app/page.tsx`. That gap is
what makes further decomposition of `page.tsx` risky: the account/week loading effects have
race guards (`currentWorkspaceRef`, debounced saves) that no test would catch breaking.

Next step is a test around week load/save ordering, then extracting `useWeekWorkspace` the way
`hooks/useAccounts.ts` was extracted.

### Server-side prompt assembly

`buildPrompt` and the response schemas are assembled in the browser and sent to the proxy, which
forwards them without inspection. An allowlisted user can patch `buildPrompt` in devtools and
spend your Gemini quota on arbitrary prompts. Within an allowlist of people you trust this is
acceptable; it stops being acceptable the moment you hand access to someone you don't.

Fix when needed: move `buildPrompt` and the schemas into the function and pass only variables
(profile, week context, feedback). `lib/plan.ts` is pure and has no SDK imports specifically so
it can be moved server-side unchanged.

## Not built

Auto-posting (Instagram Graph / LinkedIn APIs), scheduling, multi-tenant billing, tier gating.
