import assert from "node:assert/strict";
import test from "node:test";
import { imageLayout, imageLayoutPrompt, imageOverlayCopy, safeAccent } from "./image-layout.ts";
import type { Post } from "./plan.ts";

const post: Post = {
  id: "x", day: "Monday", platform: "instagram", publisher: "company", objective: "Educate",
  category: "Product", format: "carousel", source_asset: "", concept: "A system", distinct_angle: "",
  strategic_reason: "", hook: "A better system", caption: "", cta: "", hashtags: [],
  creative_type: "design", creative_brief: "Editorial", overlay_text: "Fallback title", aspect_ratio: "4:5",
  assumptions: [], facts_to_verify: [], slides: [
    { headline: "Cover", supporting_text: "Introduction", visual_direction: "Object" },
    { headline: "Detail", supporting_text: "Explanation", visual_direction: "Diagram" },
    { headline: "More detail", supporting_text: "Explanation", visual_direction: "Diagram" },
  ],
};

test("carousel layouts reserve matching alternating text and subject zones", () => {
  assert.deepEqual(imageLayout(post, 0), { template: "editorial_split", role: "cover",
    textZone: "left", subjectZone: "right", headlineScale: "large" });
  assert.equal(imageLayout(post, 1).textZone, "right");
  assert.match(imageLayoutPrompt(imageLayout(post, 1)), /right 46%/);
  assert.match(imageLayoutPrompt(imageLayout(post, 1)), /left 42%/);
});

test("standalone visuals reserve a lower text zone", () => {
  const layout = imageLayout({ ...post, format: "single_image", slides: [] }, 0);
  assert.equal(layout.template, "lower_third");
  assert.match(imageLayoutPrompt(layout), /upper 55%/);
});

test("long carousel copy receives a full-width bounded text zone", () => {
  const long = { ...post, slides: post.slides.map((slide, index) => index === 1
    ? { ...slide, supporting_text: "A detailed explanation that needs substantially more horizontal room than a narrow split layout can safely provide." }
    : slide) };
  assert.equal(imageLayout(long, 1).template, "lower_third");
});

test("CTA slides use open lower-third space without text cards", () => {
  const cta = { ...post, slides: [...post.slides, {
    headline: "Book a demo", supporting_text: "See it for yourself", visual_direction: "Hero product",
  }] };
  const layout = imageLayout(cta, 3);
  assert.equal(layout.template, "lower_third");
  const prompt = imageLayoutPrompt(layout);
  assert.match(prompt, /Do not draw any text container, card, panel, frame, box, banner/);
});

test("old posts without slides fall back to overlay copy", () => {
  assert.equal(imageOverlayCopy({ ...post, slides: [] }, 0).headline, "Fallback title");
});

test("dark brand accents fall back to a legible color", () => {
  assert.equal(safeAccent("primary #050505"), "#A78BFA");
  assert.equal(safeAccent("primary #FFFFFF"), "#FFFFFF");
});
