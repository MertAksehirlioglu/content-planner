/** Pure prompt assembly and validation. SDK calls and response schemas live in gemini.ts. */

const MAX_FIELD = 4000;
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const PLATFORMS = ["instagram", "linkedin"] as const;
export const PUBLISHERS = ["company", "founder"] as const;
export const FORMATS = ["reel", "carousel", "single_image", "text", "repost"] as const;

export type Day = (typeof DAYS)[number];
export type Platform = (typeof PLATFORMS)[number];
export type Publisher = (typeof PUBLISHERS)[number];
export type PostFormat = (typeof FORMATS)[number];

export interface StrategyItem {
  id: string;
  day: Day;
  platform: Platform;
  publisher: Publisher;
  objective: string;
  category: string;
  format: PostFormat;
  source_asset: string;
  concept: string;
  distinct_angle: string;
}

export interface Strategy { week_theme: string; rationale: string; items: StrategyItem[] }
export interface CreativeSlide { headline: string; supporting_text: string; visual_direction: string }

export interface Post extends StrategyItem {
  strategic_reason: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  creative_type: "shoot" | "existing_asset" | "design" | "ai_image" | "none";
  creative_brief: string;
  overlay_text: string;
  aspect_ratio: string;
  slides: CreativeSlide[];
  assumptions: string[];
  facts_to_verify: string[];
}

export interface Plan { week_theme: string; posts: Post[] }
export interface ContentPlanResult { strategy: Strategy; plan: Plan }

export interface PlanRequest {
  business?: unknown; audience?: unknown; tone?: unknown; language?: unknown;
  products?: unknown; founder_voice?: unknown; visual_identity?: unknown;
  approved_facts?: unknown; avoid?: unknown; platforms?: unknown; publishers?: unknown;
  frequency?: unknown; categories?: unknown; weekly_goals?: unknown; events?: unknown;
  available_assets?: unknown; requirements?: unknown; this_week?: unknown;
  feedback?: unknown; previous_plan?: unknown; strategy?: unknown;
  recent_posts?: unknown; backlog?: unknown; mode?: unknown;
  selected_post?: unknown; transformation?: unknown; style_rules?: unknown;
}

export const SYSTEM = `You are a senior social content strategist and editorial collaborator.

Build a coherent, executable content system from the approved brand profile, weekly brief,
available assets, prior content, and user feedback. Generic filler is failed work.

FACTUAL DISCIPLINE
- Never invent attendance, reactions, testimonials, results, dates, locations, product
  capabilities, project details, or first/best/only claims.
- Approved facts are the only claims you may state as facts. If an idea depends on missing
  information, put it in facts_to_verify and write a safe alternative.
- Distinguish supplied facts from creative suggestions. Do not imply you inspected a source
  or social account unless its contents are in the prompt.

EDITORIAL BEHAVIOR
- Treat Instagram company, LinkedIn company, LinkedIn founder, and founder reposts as
  different voices. A founder post needs a first-person observation, decision, lesson, or tension.
- Build a deliberate weekly mix across objective, format, subject, visual treatment, and emotion.
- Prefer supplied real-world assets when authenticity is requested. Do not default to AI imagery.
- Caption and creative must complement rather than repeat each other.
- Reuse an event or asset across channels only with a genuinely distinct angle.
- Avoid prior concepts, hooks, metaphors, and visual structures unless asked for a recurring series.
- Treat content history as a hard exclusion list. Changing synonyms, examples, or wording does not
  make a repeated central idea new. Choose a genuinely different subject, audience tension, proof
  point, narrative structure, and visual treatment. Never recycle a prior post merely into a new format.
- If the user's proposed wording is weaker, preserve intent but use the stronger editorial version.
- Hashtags are optional and should be specific; never add them merely to hit a quota.

PLATFORM BEHAVIOR
- Instagram: prioritize visual clarity, an immediate hook, and save/share/watch motivation.
  Carousels require slide-level copy; reels require sequence and footage direction.
- LinkedIn company: emphasize evidence, product understanding, market relevance, and discussion.
- LinkedIn founder: sound personal and earned, not like rewritten company marketing.
- Founder repost: add concise personal context; do not summarize the original post.
- Text posts have no visual production requirements: return empty source_asset, creative_brief,
  overlay_text, and aspect_ratio fields, and an empty slides array. Never write placeholder phrases
  such as "no visual asset required" or "new asset needed" for text posts.

Before finalizing each item check factual support, specificity, repetition, asset availability,
caption/creative duplication, CTA fit, and publisher voice.`;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_FIELD) : "";
}
function textList(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .slice(0, max).map((s) => s.trim().slice(0, 500));
}
function json(value: unknown, max = MAX_FIELD * 6): string {
  if (!value) return "";
  try { return JSON.stringify(value, null, 2).slice(0, max); } catch { return ""; }
}

/** The item count a request must produce. Shared so callers can validate what came back. */
export function resolveFrequency(req: PlanRequest): number {
  if (text(req.mode) === "transform") return 1;
  const requested = req.frequency;
  return typeof requested === "number" && Number.isInteger(requested)
    && requested >= 1 && requested <= 12 ? requested : 3;
}

export function buildPrompt(req: PlanRequest): string {
  const business = text(req.business);
  if (!business) throw new Error("business is required");
  const mode = text(req.mode) || "plan";
  const frequency = resolveFrequency(req);
  const lines = [
    // Keep this stable profile block at the beginning of the user prompt. Along with the
    // system instruction, it forms the longest reusable prefix for Gemini implicit caching.
    "APPROVED BRAND PROFILE", `Business: ${business}`,
    `Products / verticals: ${text(req.products) || "not specified"}`,
    `Audience: ${text(req.audience) || "not specified"}`,
    `Brand voice: ${text(req.tone) || "not specified"}`,
    `Founder voice: ${text(req.founder_voice) || "not specified"}`,
    `Language: ${text(req.language) || "English"}`,
    `Visual identity: ${text(req.visual_identity) || "not specified"}`,
    `Approved facts and claims:\n${text(req.approved_facts) || "None supplied; avoid unsupported claims."}`,
    `Avoid:\n${text(req.avoid) || "not specified"}`,
    `Platforms: ${textList(req.platforms).join(", ") || "instagram"}`,
    `Publishers: ${textList(req.publishers).join(", ") || "company"}`,
    `Categories: ${textList(req.categories).join(", ") || "your choice"}`,
  ];
  // Learned from this owner's past revisions. Part of the stable prefix: rules change rarely.
  const rules = textList(req.style_rules, 20);
  if (rules.length) {
    lines.push("", "LEARNED EDITORIAL RULES — this owner has corrected these before. Follow them as hard requirements:",
      ...rules.map((rule) => `- ${rule}`));
  }
  lines.push(
    "", `TASK MODE: ${mode}`,
    mode === "strategy"
      ? "Return a strategy matrix only. Do not write final captions yet."
      : mode === "combined"
        ? "Return both the strategy matrix and production-ready posts in one response. Every post must implement its matching strategy item."
        : "Return production-ready content packages for the approved strategy.",
    "", "WEEKLY BRIEF",
    `Goals: ${text(req.weekly_goals) || "not specified"}`,
    `Events / timely context: ${text(req.events) || text(req.this_week) || "nothing in particular"}`,
    `Available assets: ${text(req.available_assets) || "none specified"}`,
    `Required posts / constraints: ${text(req.requirements) || "none"}`,
    `Create exactly ${frequency} item${frequency === 1 ? "" : "s"}, spread sensibly across the week.`,
  );
  const recent = textList(req.recent_posts);
  if (recent.length) lines.push("", "CONTENT HISTORY — HARD EXCLUSIONS ACROSS PREVIOUS WEEKS", "Do not reuse or lightly reword these concepts, angles, hooks, examples, formats, or visual treatments:", ...recent.map((x) => `- ${x}`));
  const backlog = textList(req.backlog);
  if (backlog.length) lines.push("", "BACKLOG — optional source material:", ...backlog.map((x) => `- ${x}`));
  const strategy = json(req.strategy);
  if (strategy) lines.push("", "APPROVED STRATEGY — follow it exactly unless feedback changes it:", strategy);
  const previous = json(req.previous_plan);
  const feedback = text(req.feedback);
  if (previous && feedback) lines.push("", "PREVIOUS OUTPUT:", previous, "", `REVISION: ${feedback}`, "Preserve everything outside the requested scope exactly.");
  const selected = json(req.selected_post);
  const transformation = text(req.transformation);
  if (mode === "transform" && selected && transformation) lines.push("", "SELECTED POST:", selected, `TRANSFORMATION: ${transformation}`, "Return a full plan containing only the transformed post.");
  return lines.join("\n");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseStrategy(raw: string, expectedCount?: number): Strategy {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The model returned something that wasn't a strategy. Try again."); }
  if (!record(value) || typeof value.week_theme !== "string" || typeof value.rationale !== "string" || !Array.isArray(value.items)
    || !value.items.every((item) => record(item) && typeof item.id === "string"
      && DAYS.includes(item.day as Day) && PLATFORMS.includes(item.platform as Platform)
      && PUBLISHERS.includes(item.publisher as Publisher) && FORMATS.includes(item.format as PostFormat)))
    throw new Error("The model returned something that wasn't a strategy. Try again.");
  if (expectedCount !== undefined && value.items.length !== expectedCount)
    throw new Error(`The model planned ${value.items.length} items instead of ${expectedCount}. Try again.`);
  return value as unknown as Strategy;
}
export function parsePlan(raw: string, expectedCount?: number): Plan {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The model returned something that wasn't a plan. Try again."); }
  if (!record(value) || typeof value.week_theme !== "string" || !Array.isArray(value.posts)
    || !value.posts.every((post) => record(post) && typeof post.id === "string"
      && typeof post.caption === "string" && Array.isArray(post.hashtags)
      && Array.isArray(post.slides) && Array.isArray(post.facts_to_verify)
      && DAYS.includes(post.day as Day) && PLATFORMS.includes(post.platform as Platform)
      && PUBLISHERS.includes(post.publisher as Publisher) && FORMATS.includes(post.format as PostFormat)))
    throw new Error("The model returned something that wasn't a plan. Try again.");
  if (expectedCount !== undefined && value.posts.length !== expectedCount)
    throw new Error(`The model wrote ${value.posts.length} posts instead of ${expectedCount}. Try again.`);
  return value as unknown as Plan;
}

export function parseContentPlan(raw: string, expectedCount?: number): ContentPlanResult {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The model returned something that wasn't a content plan. Try again."); }
  if (!record(value)) throw new Error("The model returned something that wasn't a content plan. Try again.");
  return {
    strategy: parseStrategy(JSON.stringify(value.strategy), expectedCount),
    plan: parsePlan(JSON.stringify(value.plan), expectedCount),
  };
}
