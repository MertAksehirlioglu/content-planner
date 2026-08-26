# Security

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability
reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
(Security tab → Report a vulnerability). Please don't open a public issue for anything
exploitable.

This is a personal project maintained by one person, not a funded product: expect a reply in
days, not hours, and there is no bounty. Include what you did, what happened, and what you
expected — a proof of concept helps more than a scanner label.

## What this project is

A single-operator tool. Each deployment is one person's Firebase project, gated to an email
allowlist they control. There is no shared instance, no multi-tenant boundary, and no untrusted
user in the intended threat model. That shapes what counts as a vulnerability here.

## The security model, in full

Access control is not in the app code. It's four mechanisms:

1. **App Check** (reCAPTCHA Enterprise) — every callable runs with `enforceAppCheck: true`, so a
   request that can't attest it came from this app is refused.
2. **Auth on the callables** — `generate` rejects unauthenticated requests.
3. **`gatekeeper`** — a `beforeUserSignedIn` blocking function that refuses any email outside
   `ALLOWED_EMAILS`, and requires a verified email. It fails closed: an empty list allows nobody.
4. **`firestore.rules`** — brand data at `workspaces/{id}` is readable and writable only by the
   uids with a document in its `members/` subcollection, and `members/*` is client-read-only, so
   a signed-in user cannot add themselves to someone else's brand. Everything under `users/{uid}`
   stays locked to that user, and `billing/*` and `usage/*` are read-only to the client so a user
   cannot raise their own budget or reset their spend. Sharing a brand never shares a wallet:
   spend is metered per `request.auth.uid`, so a forged workspace id cannot reach anyone else's
   budget.
5. **Server-side membership check** — `firestore.rules` govern the browser's path to a workspace,
   not the Admin SDK path the proxy uses, so `generate` verifies membership itself before it
   reserves budget or writes a usage event.

The Firebase web config and the reCAPTCHA site key in `.env.local` are **public identifiers**,
not secrets — they ship in the bundle by design. The secrets are `GEMINI_API_KEY`,
`ALLOWED_EMAILS`, and `ADMIN_EMAILS`, all in Secret Manager and never in the repo.

## In scope

- Signing in with an email outside `ALLOWED_EMAILS`.
- Reading or writing another user's Firestore data, or the data of a workspace you are not a
  member of.
- Adding yourself to a workspace, or spending against another user's budget.
- Gaining admin (`listUsers` / `setBudget`) without being in `ADMIN_EMAILS`.
- Calling `generate` without a valid session, or getting model calls that don't count against
  a budget.
- Any secret recoverable from the repo, the bundle, or a deployed artifact.

## Known and accepted

- **A single call can finish slightly above the remaining budget.** The proxy transactionally
  reserves a conservative amount before calling Gemini, so concurrent requests cannot all pass
  against the same balance. The exact charge is only known afterwards, however, so the final
  accepted call can exceed its reservation. Keep the project-level billing budget enabled as a
  backstop.
- **Allowlisted users can send arbitrary prompts.** Prompt assembly happens in the browser and
  the proxy forwards without inspection, so anyone who can sign in can spend the operator's
  Gemini quota on prompts of their choosing. Deliberate — the allowlist is the trust boundary.

## Out of scope

Denial of service against your own instance, findings that require console or billing access you
already have, missing hardening headers with no demonstrated impact, and automated scanner output
without an exploit path.
