/** Self-check for the pure bits. No network, no build step: `npm test`.
 *  Runs on Node's native type stripping, so the import needs its .ts extension. */

import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM, buildPrompt, parseContentPlan, parsePlan, parseStrategy, resolveFrequency,
  type Plan, type PlanRequest } from "./plan.ts";

const BASE: PlanRequest = {
  business: "visionOS apps for real estate and yacht brokerages",
  audience: "brokerage owners",
  tone: "confident, technical",
  frequency: 4,
  categories: ["Behind the scenes", "Product spotlight"],
  this_week: "shipping the yacht-tour demo Thursday",
};

test("prompt carries every input", () => {
  const prompt = buildPrompt(BASE);
  for (const value of [
    "visionOS apps", "brokerage owners", "confident, technical",
    "Behind the scenes", "Product spotlight", "yacht-tour demo Thursday",
  ]) {
    assert.ok(prompt.includes(value), value);
  }
  assert.ok(prompt.includes("exactly 4 items"));
});

test("defaults fill in when fields are blank", () => {
  const prompt = buildPrompt({ business: "a cafe" });
  assert.ok(prompt.includes("exactly 3 items")); // frequency default
  assert.ok(prompt.includes("Audience: not specified"));
  assert.ok(prompt.includes("your choice")); // no categories picked
  assert.ok(prompt.includes("nothing in particular")); // quiet week
});

test("business is required", () => {
  for (const bad of [{}, { business: "   " }, { business: null }, { business: 7 }]) {
    assert.throws(() => buildPrompt(bad), /business is required/);
  }
});

test("junk in the categories array is dropped, not stringified", () => {
  const prompt = buildPrompt({ ...BASE, categories: ["Real", "", 42, null, "  "] });
  assert.ok(prompt.includes("Categories: Real"));
  assert.ok(!prompt.includes("42"));
});

test("out-of-range frequency falls back to 3", () => {
  assert.ok(buildPrompt({ ...BASE, frequency: 99 }).includes("exactly 3 items"));
  assert.ok(buildPrompt({ ...BASE, frequency: "lots" }).includes("exactly 3 items"));
  assert.ok(buildPrompt({ ...BASE, frequency: 2.5 }).includes("exactly 3 items"));
});

test("singular wording for a one-post week", () => {
  assert.ok(buildPrompt({ ...BASE, frequency: 1 }).includes("exactly 1 item,"));
});

test("feedback plus a previous plan makes it a revision", () => {
  const previous = { week_theme: "launch week", posts: [] };
  const prompt = buildPrompt({ ...BASE, previous_plan: previous, feedback: "punchier Wednesday" });
  assert.ok(prompt.includes("launch week"));
  assert.ok(prompt.includes("punchier Wednesday"));

  // Feedback with no previous plan is a fresh plan, not a revision.
  assert.ok(!buildPrompt({ ...BASE, feedback: "punchier Wednesday" }).includes("Revise"));
});

test("recent posts become a do-not-repeat section", () => {
  const prompt = buildPrompt({
    ...BASE,
    recent_posts: ["Yacht demo teaser reel", "Broker testimonial carousel"],
  });
  assert.ok(prompt.includes("CONTENT HISTORY — HARD EXCLUSIONS"));
  assert.ok(prompt.includes("Yacht demo teaser reel"));
  assert.ok(prompt.includes("Broker testimonial carousel"));
});

test("backlog ideas become a candidate-material section", () => {
  const prompt = buildPrompt({
    ...BASE,
    backlog: ["Explain the render pipeline", "Founder origin story"],
  });
  assert.ok(prompt.includes("BACKLOG"));
  assert.ok(prompt.includes("Explain the render pipeline"));
});

test("empty or junk recent_posts/backlog add no section", () => {
  const prompt = buildPrompt({ ...BASE, recent_posts: [], backlog: ["", 5, null] });
  assert.ok(!prompt.includes("Already posted"));
  assert.ok(!prompt.includes("Backlog"));
});

test("parsePlan reads a valid plan and rejects junk", () => {
  const plan: Plan = { week_theme: "launch week", posts: [] };
  assert.deepEqual(parsePlan(JSON.stringify(plan)), plan);

  for (const bad of ["not json", "42", '{"week_theme":"x"}', '{"posts":[]}', "null"]) {
    assert.throws(() => parsePlan(bad), /wasn't a plan/);
  }
});

test("prompt carries channel, publisher, assets, and approved facts", () => {
  const prompt = buildPrompt({ ...BASE, platforms: ["instagram", "linkedin"],
    publishers: ["company", "founder"], available_assets: "unused event video",
    approved_facts: "The event is May 16", founder_voice: "first-person and practical" });
  for (const value of ["instagram, linkedin", "company, founder", "unused event video",
    "The event is May 16", "first-person and practical"]) assert.ok(prompt.includes(value));
});

test("system prompt forbids invented claims", () => {
  assert.ok(SYSTEM.includes("Never invent attendance"));
  assert.ok(SYSTEM.includes("first/best/only claims"));
});

test("history deduplication rejects lightly reworded cross-week ideas", () => {
  const prompt = buildPrompt({ ...BASE, recent_posts: ["instagram | company | carousel | Product | Three deployment paths"] });
  assert.ok(prompt.includes("Do not reuse or lightly reword"));
  assert.ok(SYSTEM.includes("Changing synonyms, examples, or wording does not"));
  assert.ok(SYSTEM.includes("Never recycle a prior post merely into a new format"));
});

test("scoped transforms request exactly one post", () => {
  const prompt = buildPrompt({ ...BASE, mode: "transform", selected_post: { id: "x" },
    transformation: "Shorten it" });
  assert.ok(prompt.includes("exactly 1 item"));
  assert.ok(prompt.includes("Return a full plan containing only the transformed post"));
});

test("stable brand profile precedes task-specific and weekly context for caching", () => {
  const prompt = buildPrompt({ ...BASE, mode: "combined" });
  assert.ok(prompt.indexOf("APPROVED BRAND PROFILE") < prompt.indexOf("TASK MODE"));
  assert.ok(prompt.indexOf("TASK MODE") < prompt.indexOf("WEEKLY BRIEF"));
});

test("combined response parses its strategy and plan", () => {
  const value = {
    strategy: { week_theme: "A", rationale: "B", items: [] },
    plan: { week_theme: "A", posts: [] },
  };
  assert.deepEqual(parseContentPlan(JSON.stringify(value)), value);
});

test("learned rules render as hard requirements, and nothing appears when there are none", () => {
  const prompt = buildPrompt({ ...BASE, style_rules: ["Never open with a question.", "  "] });
  assert.match(prompt, /LEARNED EDITORIAL RULES/);
  assert.match(prompt, /- Never open with a question\./);
  assert.doesNotMatch(buildPrompt(BASE), /LEARNED EDITORIAL RULES/);
  assert.doesNotMatch(buildPrompt({ ...BASE, style_rules: "not a list" }), /LEARNED EDITORIAL RULES/);
});

test("resolveFrequency matches what the prompt asks for", () => {
  assert.equal(resolveFrequency(BASE), 4);
  assert.equal(resolveFrequency({ business: "a cafe" }), 3);
  assert.equal(resolveFrequency({ ...BASE, mode: "transform" }), 1);
  assert.equal(resolveFrequency({ ...BASE, frequency: 99 }), 3);
});

test("a plan with the wrong number of items is rejected", () => {
  const item = {
    id: "mon-ig-company", day: "Monday", platform: "instagram", publisher: "company",
    objective: "Educate", category: "Product", format: "carousel", source_asset: "render",
    concept: "c", distinct_angle: "a", strategic_reason: "r", hook: "h", caption: "cap",
    cta: "", hashtags: [], creative_type: "design", creative_brief: "b", overlay_text: "",
    aspect_ratio: "4:5", slides: [], assumptions: [], facts_to_verify: [],
  };
  const onePost = JSON.stringify({ week_theme: "t", posts: [item] });
  assert.deepEqual(parsePlan(onePost, 1).posts.length, 1);
  assert.throws(() => parsePlan(onePost, 3), /wrote 1 posts instead of 3/);
  const strategy = JSON.stringify({ week_theme: "t", rationale: "r", items: [item] });
  assert.throws(() => parseStrategy(strategy, 2), /planned 1 items instead of 2/);
  // Unspecified expectation keeps the old permissive behaviour.
  assert.equal(parsePlan(onePost).posts.length, 1);
});
