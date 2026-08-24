import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VISUAL_SYSTEM, proposedImagePrompts } from "./image-prompt.ts";
import type { Post } from "./plan.ts";

const post: Post = {
  id: "x", day: "Monday", platform: "instagram", publisher: "company", objective: "Educate",
  category: "Product", format: "carousel", source_asset: "render", concept: "Three workflows",
  distinct_angle: "clear choices", strategic_reason: "clarity", hook: "Choose a path", caption: "Caption",
  cta: "Learn more", hashtags: [], creative_type: "design", creative_brief: "Dark spatial diagrams",
  overlay_text: "", aspect_ratio: "4:5", assumptions: [], facts_to_verify: [],
  slides: [
    { headline: "First", supporting_text: "Introduction", visual_direction: "Three paths" },
    { headline: "Second", supporting_text: "Details", visual_direction: "One path" },
  ],
};

test("carousel prompts request background visuals and leave typography to Canvas", () => {
  const prompts = proposedImagePrompts(post, "navy, cream, serif headlines");
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) assert.match(prompt, /STYLE LOCK: navy, cream, serif headlines/);
  assert.doesNotMatch(prompts[0], /First|Introduction|01 \/ 02/);
  assert.match(prompts[1], /Do not render any typography/);
  assert.match(prompts[1], /app will add the exact headline/);
});

test("missing company identity receives the default visual system", () => {
  const [prompt] = proposedImagePrompts(post, "");
  assert.ok(prompt.includes(DEFAULT_VISUAL_SYSTEM));
});

test("image prompts cap verbose source fields", () => {
  const [prompt] = proposedImagePrompts({ ...post, concept: "x".repeat(2000), creative_brief: "y".repeat(3000) }, "z".repeat(3000));
  assert.ok(prompt.length < 2300);
});

test("the avoid list becomes a forbidden-subject block, and is omitted when empty", () => {
  const [withAvoid] = proposedImagePrompts({ ...post, format: "single_image" }, "navy", "stock-photo handshakes");
  assert.match(withAvoid, /NEVER DEPICT: stock-photo handshakes/);
  assert.doesNotMatch(proposedImagePrompts({ ...post, format: "single_image" }, "navy")[0], /NEVER DEPICT/);
});

test("every prompt ends up with the pre-render self-check", () => {
  for (const prompt of proposedImagePrompts(post, "navy")) assert.match(prompt, /Before finishing, scan the whole frame/);
});

test("treatment is stable per post and uniform across its slides, but varies between posts", () => {
  const treatmentOf = (prompt: string) => /Treatment: [^.]+\./.exec(prompt)?.[0] ?? "";
  const prompts = proposedImagePrompts(post, "navy");
  assert.ok(treatmentOf(prompts[0]));
  assert.equal(treatmentOf(prompts[0]), treatmentOf(prompts[1]));
  assert.equal(treatmentOf(proposedImagePrompts(post, "navy")[0]), treatmentOf(prompts[0]));
  const others = ["a", "b", "c", "d", "e", "f"].map(
    (id) => treatmentOf(proposedImagePrompts({ ...post, id }, "navy")[0]));
  assert.ok(new Set(others).size > 1);
});
