import assert from "node:assert/strict";
import test from "node:test";
import { planMarkdown } from "./export.ts";
import type { Plan, Strategy } from "./plan.ts";

const strategy: Strategy = { week_theme: "Launch week", rationale: "Balance proof and education.", items: [] };
const plan: Plan = { week_theme: "Launch week", posts: [{
  id: "wed-instagram-company", day: "Wednesday", platform: "instagram", publisher: "company",
  objective: "Educate", category: "Product", format: "carousel", source_asset: "product render",
  concept: "Showing versus experiencing", distinct_angle: "Concrete comparison", strategic_reason: "Clarifies value",
  hook: "Showing is not experiencing.", caption: "A short caption.", cta: "Book a demo", hashtags: ["#PrimeSpace"],
  creative_type: "design", creative_brief: "Dark editorial design", overlay_text: "Showing ≠ experiencing",
  aspect_ratio: "4:5", slides: [{ headline: "Showing", supporting_text: "The buyer imagines",
    visual_direction: "Use a floor plan" }], assumptions: [], facts_to_verify: ["Confirm demo URL"],
}] };

test("production brief contains channel, caption, slides, and verification notes", () => {
  const markdown = planMarkdown(strategy, plan);
  for (const expected of ["instagram / company", "A short caption.", "Slide 1: **Showing**",
    "Use a floor plan", "Confirm demo URL"]) assert.ok(markdown.includes(expected), expected);
});

test("text posts omit irrelevant visual production fields", () => {
  const textPlan: Plan = { week_theme: "Founder week", posts: [{
    ...plan.posts[0], format: "text", source_asset: "new asset needed", aspect_ratio: "",
    creative_brief: "No visual asset required for text format.", slides: [], overlay_text: "",
  }] };
  const markdown = planMarkdown(strategy, textPlan);
  assert.ok(!markdown.includes("Source asset"));
  assert.ok(!markdown.includes("Aspect ratio"));
  assert.ok(!markdown.includes("Creative brief"));
  assert.ok(!markdown.includes("No visual asset required"));
});
