# Historical design docs

Point-in-time records of how features were planned, kept because the *reasoning* is often the
part that's hard to recover later. **They are not current documentation and they were not
updated as the code changed.** For how the app works today, read
[CLAUDE.md](../../CLAUDE.md), [README.md](../../README.md), and
[infra/README.md](../../infra/README.md).

Specific ways these are now out of date:

- They describe setup as a series of Firebase **console** steps. Provisioning is Terraform now
  (`infra/`), and the project id is no longer hardcoded anywhere.
- The account-storage docs predate the server proxy: they assume the browser calls Gemini
  directly through Firebase AI Logic. It doesn't — every call goes through
  `functions/src/generate.ts`.
- They name the author's own Firebase project. Yours will differ.

| Document | What it captured |
|---|---|
| `2026-08-12-account-storage-and-post-memory-design.md` | Why account state moved from `localStorage` to Firestore, and the `users/{uid}` shape. |
| `2026-08-12-account-storage-and-post-memory.md` | The implementation plan for the above. |
| `2026-08-13-onboard-brand-design.md` | The onboard-brand skill and the prefill-from-JSON affordance. |
| `2026-08-13-per-user-budgets.md` | The per-user budget layer: the proxy as a metering chokepoint, and why budget/spend docs are client-read-only. |
