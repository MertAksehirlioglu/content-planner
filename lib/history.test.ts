import assert from "node:assert/strict";
import test from "node:test";
import { postFingerprint, selectRelevantFingerprints } from "./history.ts";
import type { Post } from "./plan.ts";

const post = {
  id: "x", day: "Monday", platform: "linkedin", publisher: "founder", objective: "educate",
  category: "Rendering", format: "carousel", source_asset: "", concept: "Why yacht renders fail",
  distinct_angle: "Lighting decisions before geometry", strategic_reason: "", hook: "Your geometry is not the problem",
  caption: "", cta: "", hashtags: [], creative_type: "design", creative_brief: "split-screen render",
  overlay_text: "", aspect_ratio: "4:5", assumptions: [], facts_to_verify: [],
  slides: [{ headline: "A", supporting_text: "", visual_direction: "before and after lighting" }],
} satisfies Post;

test("post fingerprints retain deduplication dimensions in a compact form", () => {
  const result = postFingerprint(post);
  for (const value of ["topic=Rendering", "claim=Why yacht renders fail", "angle=Lighting decisions",
    "channel=linkedin/founder", "1-slide carousel"]) assert.ok(result.includes(value));
  assert.ok(result.length <= 620);
});

test("history selection ranks relevant entries and caps prompt growth", () => {
  const history = ["coffee launch", "yacht lighting workflow", ...Array.from({ length: 40 }, (_, i) => `generic item ${i}`)];
  const selected = selectRelevantFingerprints(history, "yacht render lighting", 30);
  assert.equal(selected[0], "yacht lighting workflow");
  assert.equal(selected.length, 30);
});
