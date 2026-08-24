---
name: onboard-brand
description: Use when onboarding a new customer/business into the content planner — turn supplied company material (pasted text, a webpage URL, or a PDF/txt file path) into a filled brand Profile JSON the operator pastes into the app's Brand workspace. Triggers on "onboard this customer", "set up a brand from this site/deck/PDF", "fill the brand brain from this".
---

# Onboard a brand from company material

Turn a company's own material into a `Profile`-shaped JSON block that the operator pastes
into the app (Brand workspace → **Prefill brand from JSON**). You do the reading and
extraction; the operator reviews and saves.

The schema is owned by `lib/profile.ts`. If that file and this skill disagree, the file
wins — read it before emitting JSON if unsure.

## 1. Get the source

Ask for / accept exactly one of:
- **Pasted text** — a blurb, about page, or notes in the conversation. Use as-is.
- **A file path** — a `.pdf`, `.txt`, or `.md` on disk. Read it with the **Read** tool
  (it reads PDF bytes and text natively — no parser, no conversion).
- **A URL** — a company website or about page. Fetch it with **WebFetch**. You fetch it,
  not a browser, so static-export CORS does not apply.

If the source can't be read (bad path, failed fetch, empty page), say so and ask for a
usable source. Do **not** emit a half-empty profile from a broken read.

## 2. Map the source onto the Profile fields

| Field | What goes in it | Default if unstated |
|---|---|---|
| `business` | What the business is and what it sells | `""` |
| `audience` | Who they talk to | `""` |
| `tone` | Tone of voice | `""` |
| `language` | Output language | `"English"` |
| `products` | Product names, verticals, markets, distinctions | `""` |
| `founderVoice` | How the founder sounds / topics they can credibly own — only if the source reveals it | `""` |
| `visualIdentity` | Brand colors, fonts, visual rhythm — only if present in the source | `""` |
| `approvedFacts` | See grounding rules below | `""` |
| `avoid` | Explicit "don't say / don't show" guidance, if any | `""` |
| `platforms` | Subset of `["instagram","linkedin"]` | `["instagram"]` |
| `publishers` | Subset of `["company","founder"]` | `["company"]` |
| `frequency` | Posts per week, integer 1–7 | `3` |
| `styleRules` | Always `[]` — the app learns these in-app from revisions; never seed them | `[]` |

Omit `allCategories` and `categories` entirely — the app supplies sensible defaults, and
`normalizeProfile` fills them.

## 3. Grounding rules (the whole point)

- **Never invent facts.** `approvedFacts` receives **only** claims the source states
  explicitly — capabilities, results/metrics, links, contact details, event specifics.
  The app treats `approvedFacts` as the *sole* ground-truth the model may assert, so a
  single hallucinated claim here contaminates every generated post. When in doubt, leave
  it out.
- A field the source doesn't support stays at its default. Do not guess to fill space.
- Interpretive fields (`tone`, `audience`, and similar) may be inferred **conservatively**
  from the material — but flag them as inferred in the Gaps list (step 4).

## 4. Output

Emit two things, in this order:

1. **One fenced `json` block** — a single object with the fields above. This is what the
   operator copies. Example shape:

   ```json
   {
     "business": "...",
     "audience": "...",
     "tone": "...",
     "language": "English",
     "products": "...",
     "founderVoice": "",
     "visualIdentity": "",
     "approvedFacts": "...",
     "avoid": "",
     "platforms": ["instagram", "linkedin"],
     "publishers": ["company"],
     "frequency": 3,
     "styleRules": []
   }
   ```

2. **A short "Gaps" list** — bullet the fields you left empty and any values you inferred
   rather than lifted, so the operator knows what to check before saving. Example:
   > **Gaps to review:** `founderVoice`, `visualIdentity`, `avoid` left empty (not in
   > source). `tone` and `audience` are inferred from the site copy, not stated.

Then tell the operator: paste the JSON into **Brand workspace → Prefill brand from JSON →
Apply** on the new account, then review the gaps.

## Do not

- Call Gemini, write to Firestore, or add dependencies. All reading uses Read / WebFetch.
- Fill `approvedFacts` with anything not explicitly in the source.
- Seed `styleRules`.
