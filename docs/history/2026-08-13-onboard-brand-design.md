# Onboard-brand skill + Prefill-from-JSON — Design

**Date:** 2026-08-13
**Status:** Approved for implementation

## Problem

Onboarding a new customer means filling the brand brain (`Profile` in `lib/profile.ts`)
by hand: ~9 text fields plus platform/publisher/frequency choices, typed into the Brand
workspace panel. Customers arrive with material that already contains most of this — a
company one-pager, a website, a brand deck PDF. We want to turn that material into a
filled brand profile with minimal manual entry.

Constraint from the user: this is a **Claude Code skill** (the operator runs it), not an
in-app self-serve feature. The skill consumes pasted text, a webpage URL, or a PDF, and
produces brand data the operator drops into the app.

## Solution overview

Two small, independent pieces:

1. **`onboard-brand` skill** — a project skill that drives Claude to read a source and emit
   one `Profile`-shaped JSON block. No new app code, no dependencies.
2. **"Prefill brand from JSON" box** — a ~15-line affordance in the Brand workspace panel
   that pastes that JSON into the active account in one shot, reusing existing validation
   and save paths.

They are decoupled: the skill's contract is "valid `Profile` JSON"; the import box's
contract is "accept `Profile` JSON". Either can change independently as long as the JSON
shape (owned by `lib/profile.ts`) holds.

## Piece 1 — the skill

**Location:** `.claude/skills/onboard-brand/SKILL.md` (project skill — tied to this repo's
`Profile` schema, ships with the repo).

**Trigger:** operator asks to onboard/set up a new customer or brand from supplied
material (text, a URL, or a PDF/txt file path).

**Flow the skill instructs Claude to follow:**

1. **Obtain the source.** One of: text pasted into the conversation, a webpage URL, or a
   path to a PDF/txt file already on disk.
2. **Read it with the right tool — no new code:**
   - Pasted text → use as-is.
   - File path (`.pdf`, `.txt`, `.md`) → `Read` tool (reads PDF bytes and text natively).
   - URL → `WebFetch`. Claude fetches it, not the browser, so static-export CORS does not
     apply.
3. **Map source content onto the `Profile` fields.** The skill lists each field with the
   same intent the panel placeholders convey:
   - `business` — what the business is and what it sells.
   - `audience` — who they talk to.
   - `tone` — tone of voice.
   - `language` — output language (default `"English"` if unstated).
   - `products` — product names, verticals, markets, distinctions.
   - `founderVoice` — how the founder sounds / topics they can own (only if the source
     reveals it).
   - `visualIdentity` — brand colors, fonts, visual rhythm (only if present).
   - `approvedFacts` — see grounding rules below.
   - `avoid` — explicit "don't say / don't show" guidance if present, else `""`.
   - `platforms` — `["instagram" | "linkedin"]`; default `["instagram"]` if unclear.
   - `publishers` — `["company" | "founder"]`; default `["company"]` if unclear.
   - `frequency` — integer 1–7; default `3` if unstated.
   - `styleRules` — always `[]` (learned in-app from revisions; never seeded here).
   - `allCategories` / `categories` — omit; the app defaults them.
4. **Grounding rules (the point of the skill):**
   - **Never invent facts.** `approvedFacts` receives *only* claims the source states
     explicitly (capabilities, results, links, contact details, event specifics). The app
     treats `approvedFacts` as the sole ground-truth the model may assert, so a
     hallucinated claim here propagates into every generated post.
   - A field the source does not support stays `""` (or its default). Do not guess to
     fill space.
   - `tone`, `audience`, and similar interpretive fields may be inferred conservatively
     from the material; the skill flags which values were inferred vs. lifted verbatim.
5. **Output:**
   - **One fenced ```json block** containing a single object matching `Profile` (fields
     above). This is what the operator pastes into the app.
   - **A short "Gaps" list** naming fields left empty and any values that were inferred, so
     the operator knows what to review before saving.

**What the skill deliberately does not do:** call Gemini, write to Firestore, add
dependencies, or run a PDF parser. All source reading uses tools Claude already has.

## Piece 2 — Prefill brand from JSON box

**Location:** top of the Brand workspace panel, `app/page.tsx` (just under the panel
heading at ~line 537, above the "Your business" accordion).

**UI:** a collapsed affordance (Mantine `Accordion.Item` or a small `Collapse`) labeled
"Prefill brand from JSON" containing a `Textarea` and an "Apply" button, plus one line of
helper text: *"Paste brand JSON from the onboard-brand skill. Replaces all brand fields —
use on a new account."*

**Behavior on Apply:**

```
updateActive(() => normalizeProfile(pastedText))
```

- `normalizeProfile` (`lib/profile.ts`) already validates every field of untrusted JSON
  and falls back to defaults per field — it *is* the import validator, so no new
  validation code.
- `updateActive` (`app/page.tsx:230`) already handles optimistic state update + debounced
  `updateAccountProfile` Firestore write. Reused unchanged.
- On empty/whitespace input: no-op (guard).
- After a successful apply: clear the textarea and collapse the box.

**`ponytail:` ceiling —** this *replaces* the whole profile (missing JSON fields become
their defaults). Correct for onboarding a fresh, empty account; re-applying onto a
populated profile overwrites it. Acceptable for the stated use case; the helper text says
so. Upgrade path if ever needed: merge only keys present in the parsed object.

## Data flow

```
source (text / URL / PDF path)
      │  Read / WebFetch (Claude, no app code)
      ▼
Claude maps → Profile JSON  ──(operator copies)──▶  Prefill box textarea
                                                          │ normalizeProfile
                                                          ▼
                                                   updateActive()
                                                          │ debounced write
                                                          ▼
                                              updateAccountProfile → Firestore
```

## Error handling

- **Skill:** if a source can't be read (bad path, fetch fails, empty page), Claude reports
  it and asks for a usable source rather than emitting a half-empty profile silently.
- **Import box:** malformed/junk JSON is absorbed by `normalizeProfile`, which returns
  `EMPTY_PROFILE` on parse failure. That means a bad paste silently blanks the form — so
  the box guards the obvious empty-input case and the helper text sets the expectation
  that it replaces fields. (We accept `normalizeProfile`'s existing behavior rather than
  adding a parse-error toast; keeping one validator is the lazy-correct call. If blanking
  turns out to bite, add an "is this really JSON?" check before applying.)

## Testing

- **Skill:** no automated test — it is an instruction file. Manual check: run it against a
  sample company blurb and confirm the JSON parses and `approvedFacts` contains only
  sourced claims.
- **Import box:** the logic is `normalizeProfile(text)`, already covered by
  `lib/profile.test.ts`. The wiring is a one-liner through existing `updateActive`. No new
  unit test warranted (trivial glue); a manual paste-and-verify is the check. If we want a
  guard test, assert `normalizeProfile("{}")` returns `EMPTY_PROFILE` (already implied by
  existing tests).

## Files touched

- **New:** `.claude/skills/onboard-brand/SKILL.md`
- **Edit:** `app/page.tsx` — add the Prefill box in the Brand panel.
- **New:** this design doc.

No changes to `lib/profile.ts`, `lib/store.ts`, or any pure module. No new dependencies.
