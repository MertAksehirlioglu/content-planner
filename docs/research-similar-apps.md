# Competitive / prior-art research — similar apps and open-source alternatives

Date: 2026-08-12. Written against the current state of this repo (Gemini via Firebase AI Logic,
strategy → approval → posts, Instagram + LinkedIn, company + founder voices, AI image generation
with a deterministic Canvas text overlay).

The centrepiece question is **how these systems keep output consistent** — the actual system
prompts for strategy/copy, and the actual prompts + plumbing for image generation. That question
is only answerable for open-source projects, so their prompts are quoted from source below.
For closed tools, only observed/documented behaviour is available and it is labelled as such.

---

## 1. The field

Verified live at the time of writing (stars/licence/last push read from the GitHub API).

| Project | What it is | Stars | Licence | Last push |
|---|---|---|---|---|
| [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) | Self-hostable scheduler for 30+ networks, with an AI post-generation agent, MCP server, agent CLI | 34.6k | AGPL-3.0 | 2026-08-12 |
| [langchain-ai/social-media-agent](https://github.com/langchain-ai/social-media-agent) | LangGraph pipeline: source content → marketing report → post → images → human-in-the-loop approve/schedule | 2.7k | MIT | 2026-08-11 |
| [Mixpost](https://mixpost.app/) | Laravel/Vue self-hosted scheduler, 11 networks, AI caption assistant | — | Lite free / Pro $299 one-time | active |
| [muneebhashone/auren-content](https://github.com/muneebhashone/auren-content) | **Closest structural twin to this repo**: weekly strategy → posts, personas, story bank, feedback loop, image gen | 10 | MIT | 2026-05-26 |
| [blacktwist/social-media-skills](https://github.com/blacktwist/social-media-skills) | Prompt-only: 12 Claude/Codex skills (strategy, calendar, hooks, captions, carousels, analysis) over a shared context file | 413 | MIT | 2026-05-01 |
| [stevenflanagan1/social-ai-team](https://github.com/stevenflanagan1/social-ai-team) | Prompt-only "AI social team for SMBs": brand onboarding → calendar → captions → **creative designer** → performance review | 185 | none stated | 2026-05-07 |
| [sergebulaev/linkedin-skills](https://github.com/sergebulaev/linkedin-skills) | 11 LinkedIn-specific writing/cadence skills | 540 | MIT | 2026-08-09 |
| [Anil-matcha/Free-AI-Social-Media-Scheduler](https://github.com/Anil-matcha/Free-AI-Social-Media-Scheduler), [SamurAIGPT/social-post](https://github.com/SamurAIGPT/social-post) | Thin Next.js "generate a post" SaaS boilerplates | 484 / — | open | active |

Closed comparators worth knowing: **Predis.ai** (closest commercial analogue — brand kit → caption +
branded creative in one shot), **Jasper** (Brand IQ / Brand Voice — the strongest commercial answer to
the consistency problem), **Buffer AI Assistant**, **FeedHive**, **ContentStudio**, **Ocoya**.

Deliberately excluded: pure schedulers with no generation (Hootsuite/Later/Publer core), scrapers,
YouTube/short-video automation, and Nano-Banana CLI wrappers — they solve a different problem.

---

## 2. Consistency: how each system actually does it

### 2.1 The three strategies in use

Across everything examined there are only three mechanisms for keeping output on-brand, and every
product is a mix of them:

1. **Persistent brand context injected into every call** — a "brand brain". Jasper IQ, Predis brand
   kit, `social-media-context-sms.md`, `context/brand-style.md`, this repo's stored account profile.
2. **Prompt-level hard constraints** — quotas, exclusion lists, forbidden-element lists, self-check
   passes. LangChain and auren-content lean hardest here.
3. **Determinism outside the model** — code, not prompt, owns the part that must not drift: SVG/Canvas
   template compositing for typography, schema validation for structure. Only LangChain and this repo
   do this on the image side.

The interesting finding: **nobody in open source combines all three except this repo and, partially,
LangChain's agent.** The scheduler-first projects (Postiz, Mixpost) have essentially none of it.

### 2.2 Strategy / text prompts

**auren-content** — `lib/llm/prompts/strategy.ts`. The single closest thing to `lib/plan.ts`'s
`SYSTEM` + `buildPrompt` found anywhere. System prompt opens:

> You are a senior B2B content strategist. You produce a tight weekly plan that ladders up to a
> quarterly objective AND mixes four content types so the feed engages, not just informs.

then emits a strict JSON `WeekPlan { week_theme, reasoning, slots[] }`. What it does that this repo
does not:

- **Hard numeric quotas.** `Total slots MUST exactly equal the sum of each persona's per-platform
  cadence` and `Content-type quotas (HARD): the slots array MUST contain exactly the per-type counts
  given in the user message.` The mix is computed in code (percentages → absolute counts) and passed
  in as numbers, so "variety" is enforced arithmetically rather than requested rhetorically.
- **Grounding by citation.** Each slot carries `signal_ids: number[]` referencing researched signals,
  and `signal_ids` is REQUIRED (≥1) for `content_type='research'`. Facts are traceable to a source ID
  rather than trusted.
- **A story bank with ownership scoping.** `story_bank_id` is REQUIRED for story slots, and
  `A persona-tagged entry can ONLY be used by that persona`.
- **Per-type behavioural guidance with explicit guardrails**, e.g. the opinion type:
  `HARD GUARDRAILS: NO politics, NO religion, NO ethics-as-identity, NO protected-group references,
  NO naming individuals to attack… Punch up at processes, not people.`
- **Scheduling heuristics in the prompt** (LinkedIn Tue–Thu 8–10am, Reddit weekday mornings) plus a
  per-slot `why_this_slot` rationale field.
- **A performance feedback channel**: `performancePatterns` — a free-text digest of what worked — is
  appended to the user message every week.

It also splits the job across *separate* prompt files rather than one system prompt: `research.ts`,
`strategy.ts`, `writer.ts`, `hook-critic.ts`, `polish.ts`, `rationale.ts`, `feedback-analysis.ts`.

**langchain-ai/social-media-agent** — prompts live in `src/agents/generate-post/prompts/index.ts` and
are explicitly designed as *the* customisation surface. Four named blocks, each documented with why
you'd edit it:

- `BUSINESS_CONTEXT` — "used widely throughout the agent… content validation, and post generation".
- `POST_STRUCTURE_INSTRUCTIONS` — the post skeleton as `<section key="1|2|3">` (hook ≤5 words →
  body ≤3 sentences → CTA 3–6 words).
- `POST_CONTENT_RULES` — flat rule list, e.g. `NEVER use hashtags in the post.` /
  `ALWAYS use present tense to make announcements feel immediate`.
- `CONTENT_VALIDATION_PROMPT` — a gate that rejects source material before any writing happens.

Few-shot is a first-class citizen: `TWEET_EXAMPLES` wraps curated example posts in
`<example index="n">` tags, and the generation prompt tells the model to use them as style anchors.
Generation itself is a two-step visible process (`<thinking>` notes, then `<post>`).

Its most transferable idea is `src/agents/reflection/prompts.ts`: after a human edits a draft, a
**reflection prompt** compares original vs revised vs the user's comment and decides whether to mint a
durable rule —

> You should not be generating a rule which is specific to this post, like business logic. The rule, if
> created, should be applicable to any future post.

— with a companion `UPDATE_RULES_PROMPT` that merges/deduplicates/resolves conflicts in the rule set.
That is a learned style memory built out of ordinary revision feedback. This repo currently throws
that signal away after the revision round-trip.

**Postiz** — `libraries/nestjs-libraries/src/agent/agent.graph.service.ts`. A LangGraph chain
(category → topic → hook → content → images) with short, generic, brand-free prompts:

> You are an assistant that gets existing hook of a social media, content and generate only the content.
> - Don't add any hashtags — Make sure it sounds {tone} — … — Don't be cringy — Use simple english

There is **no brand profile anywhere in the prompt path** — the only personalisation is a `tone` enum
and a length/format enum. Structure is enforced with Zod structured output. Postiz is a scheduling
product with a content generator bolted on; consistency is not something it attempts.

**blacktwist/social-media-skills** and **social-ai-team** — no application code at all, just skill
markdown. Their consistency mechanism is a **file**: `.agents/social-media-context-sms.md` /
`context/brand-style.md`, read at the start of every skill, with an explicit instruction to skip any
discovery question the file already answers. Cheap, portable, and effective — and it doubles as the
onboarding UX (a dedicated `brand-onboarding` / `social-media-context-sms` skill writes the file).

**Jasper (closed)** — the commercial version of the same idea, productised: Brand Voice (tone,
on-brand and forbidden words), Knowledge Base (products, messaging, FAQs, positioning), audiences,
style guide and visual standards, all applied automatically to every generation across the workspace.
Documented behaviour, not inspectable.

### 2.3 Image prompts and brand-consistent visuals

This is where the gap between projects is widest.

**Postiz** — bare pass-through. The copy model is asked for an image prompt inside its structured
output:

> Prompt to generate a picture for this post later, make sure it doesn't contain brand names and make
> it very descriptive in terms of style

…and that string goes straight to DALL·E (`dalle.invoke(p.prompt!)`). No palette, no style lock, no
typography control. A separate service prompt asks a model to expand a description into "a very long
and descriptive explanation… if it's realistic describe the camera". Output will drift post to post.

**auren-content** — also pass-through (`lib/images/codex-image.ts` simply POSTs `imagePrompt` to an
image endpoint at a fixed size). Strong on strategy, nothing on visual identity.

**langchain-ai/social-media-agent** — the most sophisticated open-source implementation, and the
closest cousin to this repo's approach. `src/agents/find-and-generate-images/nodes/generate-images.ts`
holds `GENERATE_IMAGE_PROMPT_TEMPLATE` as a **structured JSON object, not prose**, serialised with
`JSON.stringify(..., 2)` at call time. Its parts:

- `role` / `purpose` / `core_design_principles` (audience, tone, constraints)
- `constraints` entries carry a `severity: "CRITICAL"` field and explicit `strictly_forbidden` arrays —
  `flat_2d_only`, `no_parenthetical_labels`, `no_color_legends_or_hex_codes`, `no_logo_imagery`,
  `no_design_metadata_in_image`. Notably: *"The brand color palette is for YOUR internal use only.
  NEVER show it to viewers."* and *"All design details in this prompt are for YOUR reference only —
  they must NEVER appear in the final image."*
- a full `color_palette` (core / accent / secondary hex tokens) plus `usage_rules` for pairing,
  contrast and gradients
- step-by-step `image_generation_instructions` (analyse input → visual style → title with explicit
  **ragging rules**: "Never leave a single word alone on the last line" → approved backgrounds with
  required text-contrast pairings → lighting → output ratio)
- a `final_reflection` block: a mandatory self-check with an `absolute_zero_tolerance` list and
  *"If YES, you MUST regenerate. These are FATAL errors."*
- `input: { report, post, style_variation }` — placeholders filled per call

Variety without drift comes from **`STYLE_VARIATIONS`**: eight hard-coded background/accent recipes
drawn from the same palette, selected by index. The model never chooses colours; it chooses within a
fixed rotation.

Finally, and most importantly, the brand frame is **not** generated: `embedImageInTemplate()` in
`helpers.ts` takes the model's raw image, injects it as a data URI into a hard-coded
`COMMUNITY_TEMPLATE_SVG` (logo, background, rounded content well), rewrites the pattern transform
matrix, and rasterises with `sharp`. Logo and layout are pixel-identical every time because code, not
the model, draws them.

**social-ai-team** (`skills/social-creative-designer/SKILL.md`) — the best *methodology* writeup found,
and the only one to take real assets seriously. Four modes: **Generate** (AI image from concept),
**Composite** (client's real product photo anchored inside an AI-generated scene), **Brand** (real
photo + brand text treatment only), **Stop-Motion Reel**. Its rules:

> For product brands, Composite mode is the default for product posts. The product — its packaging,
> labels, and design — must always be the client's real asset, never AI-approximated. Generate mode is
> only appropriate for lifestyle or atmospheric content… A post with an AI-approximated product is not
> client-ready.

Prompts follow a fixed **6-element framework** (subject, composition, lighting, colour, style, plus
overlay text/mood) with every element required, a **negative prompt derived from the brand do/don't
rules**, and a **reference-input role protocol** — up to three input images (product photo, style
reference, scene reference) each with an explicitly declared role. It also emits a prompt log and a
creative brief with a brand-compliance checklist (palette / typography / mood) per asset.

**Predis.ai (closed)** — brand kit (logo, colours, fonts, tone) applied to every generated post, output
as template-composited carousels/single images/videos. Documented behaviour; implementation opaque. It
is the nearest thing to a commercial version of this repo's image path.

### 2.4 Where this repo sits

`lib/image-prompt.ts` already implements the strongest pattern available:

- a **STYLE LOCK** line built from the account's `visual_identity` (falling back to
  `DEFAULT_VISUAL_SYSTEM`), repeated identically on every slide of a carousel
- explicit *"Leave generous negative space for a deterministic text overlay. No letters, words,
  numbers, logos, watermarks, or fake UI."* — the model is forbidden from rendering type at all
- `imageLayout()` / `imageLayoutPrompt()` — layout chosen in code, described to the model
- exact headline / supporting text / page marker drawn later with Canvas
- a **style reference image** passed as `inlineData` alongside the text prompt (`lib/image.ts`)

That combination — style lock + no-typography rule + deterministic overlay + reference-image
conditioning — is not matched by any open-source project examined. LangChain gets there for a fixed
in-house brand (hard-coded palette, hard-coded SVG); this repo does it per account, from a profile.

On the text side, `SYSTEM` in `lib/plan.ts` is longer and stricter than anything in the field
(factual discipline, per-publisher voice separation, content history as a hard exclusion list,
per-platform behaviour, a pre-finalisation checklist), and `parsePlan`/`parseStrategy` validate the
result structurally. The genuine gaps versus the field are quotas-as-numbers, citation-style
grounding, and a learned-rules memory — see §4.

---

## 3. Comparison on the other axes

| | this repo | Postiz | Mixpost | LC social-media-agent | auren-content | skill packs (blacktwist / social-ai-team) | Predis / Jasper (closed) |
|---|---|---|---|---|---|---|---|
| **Brand brain** | Firestore account profile: voice, founder voice, visual identity, approved facts, avoid list, categories | none (tone enum only) | none | `BUSINESS_CONTEXT` prompt constant, edited in source | DB: ICP, pillars, anti-goals, personas, story bank | a markdown context file | yes, productised (Brand IQ / brand kit) |
| **Multi-account** | yes, per user | workspaces | workspaces | single brand | single brand | one file per project dir | yes |
| **Strategy step before content** | **yes — strategy matrix approved, then posts** | no | no | no (report → post, no week plan) | **yes — weekly slot plan** | yes (strategy + calendar skills) | partially (calendar suggestions) |
| **Content-history dedup** | yes — `recent_posts` as hard exclusion list + fingerprints (`lib/history.ts`) | no | no | dedup of already-posted *sources* | performance patterns digest; no exclusion list | manual | recycling features, not dedup |
| **Learned style memory** | no | no | no | **yes — reflection rules from user edits** | feedback-analysis prompt | no | yes (voice tuning) |
| **Image approach** | AI image + **style lock** + code-drawn text overlay + style reference image | DALL·E pass-through | none (media library) | AI image + palette JSON + **SVG template composite** | pass-through | prompt framework + real-asset compositing (manual) | template compositing from brand kit |
| **Platforms** | IG + LinkedIn, company + founder | 30+ | 11 | X + LinkedIn | X + LinkedIn + Reddit | text-first platforms | many |
| **Auto-posting** | no (by design) | yes | yes | yes (Arcade) | no | via publisher skill | yes |
| **Human approval** | strategy approval + revision loop | scheduling UI | approval workflows | LangGraph interrupt | edit before publish | conversational | ContentStudio-style approvals |
| **Self-host / licence** | private | AGPL-3.0 | Lite free (3 networks) / Pro $299 one-time | MIT | MIT | MIT / unstated | SaaS only |
| **Cost model** | per-generation API cost (`lib/cost.ts`) | free self-host, paid cloud | one-time licence | your API keys | your API keys | your API keys | ~$15–30/mo entry, Jasper higher |

Two structural observations:

- **The strategy-first workflow is genuinely rare.** Of everything examined, only auren-content and the
  prompt-only skill packs separate "decide the week" from "write the posts", and only this repo makes
  the strategy an explicit *approval gate* in a UI. Postiz, Mixpost, Ocoya, Buffer and friends are
  scheduler-first: the unit of work is a post, and generation is a text box next to the composer.
- **The market splits on where the value sits.** Commercial tools charge for *distribution*
  (connections, queues, analytics, approvals) and treat AI as an add-on. This repo charges — in effort —
  for *editorial judgement* and treats distribution as out of scope. That is a defensible position, but
  it means the closest true competitors are Predis.ai and Jasper, not Buffer.

---

## 4. Takeaways for content-planner

**Status:** items 1, 2, 5 and 6 were implemented on 2026-08-12, along with a per-post treatment
rotation (a variant of 3) and the reference-image role protocol (half of 4). What remains is real
composite mode — a user-uploaded product photo as an unalterable anchor, which needs upload UI.

**Worth stealing, roughly in value order:**

1. **Reflection rules from revision feedback** (LangChain). Every revision round-trip already sends
   `previous_plan` + `feedback`. One extra call after an accepted revision — "is there a durable,
   post-independent rule here?" — plus a merge/dedupe pass, gives a per-account learned style memory
   stored next to the profile and injected into `SYSTEM`. Highest ratio of value to work, and it uses a
   signal currently discarded.
2. **Quotas as numbers, not adjectives** (auren-content). "Build a deliberate weekly mix" is a wish;
   `research: 2, story: 1, opinion: 1` computed in code and declared a HARD requirement is enforceable,
   and `parseStrategy` can verify it and retry. Same for per-platform / per-publisher counts, which are
   already implied by `platforms` × `publishers` × `frequency`.
3. **A style-variation rotation** (LangChain `STYLE_VARIATIONS`). Carousels currently get an identical
   style lock on every slide — safe but potentially monotonous across a week. A small fixed set of
   background/accent recipes *derived from the account's visual identity*, selected by index, buys
   variety without letting the model choose colours.
4. **Composite mode for real assets** (social-ai-team). The profile already has `available_assets` and
   `creative_type: "existing_asset"`, and `lib/image.ts` already passes a reference image. The missing
   piece is the *role protocol*: declare explicitly which input is the product/anchor (must not be
   altered) versus the style reference versus the scene reference. For the pilot business — visionOS
   walkthroughs of real properties and yachts — "never AI-approximate the real thing" is exactly the
   right default.
5. **Negative prompts from the avoid list.** `avoid` feeds the text prompt but not the image prompt. A
   forbidden-elements block in `visualSystem()`, in LangChain's `strictly_forbidden` style, is a few
   lines.
6. **A pre-render self-check block** (LangChain `final_reflection`). Cheaper than a second model call
   and demonstrably reduces the classic failure modes (stray typography, watermarks, fake UI) that the
   Canvas-overlay design depends on not happening.

**Deliberately skip:**

- **Structured-JSON image prompts.** LangChain serialises a JSON object as the image prompt. It reads
  well in source but the current line-oriented prompt is shorter and already carries the same content;
  no evidence the format itself helps.
- **Postiz-style multi-step chains** (category → topic → hook → content as separate calls). One call
  per plan is the cheaper and more coherent design; a chain would multiply latency and cost against the
  ~30s round-trip bar for no gain in output quality — their per-step prompts are weaker than this
  repo's single system prompt.
- **Adopting or forking Postiz/Mixpost.** They solve distribution, which is explicitly out of scope,
  and adopting either means inheriting a scheduler-shaped product where generation is a side feature.
  Worth revisiting only if auto-posting (the "Max tier") ever becomes real — at which point Postiz's
  AGPL connector layer is the interesting part, not its AI.
- **Per-role prompt file splits** (auren-content's seven prompt files). The single `SYSTEM` +
  `buildPrompt` in a pure, test-covered module is working; splitting is a refactor with no user-visible
  payoff.
- **Research/signal ingestion with citations.** Attractive, but it means a search/scrape pipeline and a
  signals store. The `approved_facts` + `facts_to_verify` mechanism already covers the safety half of
  what citations buy. Revisit only if timeliness becomes a complaint.

**Positioning, in one line:** the differentiators that no open-source alternative matches are the
*strategy approval gate*, the *content-history hard-exclusion list*, and the *style-lock plus
deterministic text overlay* image pipeline. Everything else in the product exists elsewhere in some
form.

---

## Sources

- [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) — `agent.graph.service.ts`, `openai.service.ts`
- [langchain-ai/social-media-agent](https://github.com/langchain-ai/social-media-agent) — `generate-post/prompts/index.ts`, `nodes/generate-post/prompts.ts`, `reflection/prompts.ts`, `find-and-generate-images/nodes/generate-images.ts`, `find-and-generate-images/helpers.ts`
- [muneebhashone/auren-content](https://github.com/muneebhashone/auren-content) — `lib/llm/prompts/strategy.ts`, `lib/images/codex-image.ts`
- [blacktwist/social-media-skills](https://github.com/blacktwist/social-media-skills) — `skills/content-strategy-sms/SKILL.md`
- [stevenflanagan1/social-ai-team](https://github.com/stevenflanagan1/social-ai-team) — `skills/social-creative-designer/SKILL.md`
- [Mixpost](https://mixpost.app/) · [Mixpost pricing](https://mixpost.app/pricing)
- [Predis.ai review, 2026](https://digitalbydefault.ai/blog/predis-ai-social-content-review-2026)
- [Jasper Brand IQ](https://www.jasper.ai/brand-iq) · [Jasper Brand Voice](https://www.jasper.ai/brand-voice)
- [Best AI social media tools 2026 (Apaya)](https://apaya.com/blog/best-ai-social-media-tools) — Buffer / FeedHive / ContentStudio / Ocoya positioning
