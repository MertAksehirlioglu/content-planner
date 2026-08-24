import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatedImageBatchCost, usageSnapshot } from "./cost.ts";

test("usage metadata is normalized including image modality tokens", () => {
  const snap = usageSnapshot({
    promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 35,
    candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 12 }, { modality: "IMAGE", tokenCount: 8 }],
    cachedContentTokenCount: 3,
  });
  assert.deepEqual(snap, {
    promptTokens: 10, outputTokens: 20, thinkingTokens: 5,
    totalTokens: 35, outputImageTokens: 8, cachedTokens: 3,
  });
});

test("partial detail entries from the model do not throw", () => {
  // Untrusted model output: a details entry may omit modality, tokenCount, or both.
  const snap = usageSnapshot({
    candidatesTokensDetails: [{ tokenCount: 5 }, { modality: "IMAGE" }, { modality: "IMAGE", tokenCount: 7 }],
  });
  assert.equal(snap.outputImageTokens, 7);
});

test("absent metadata defaults everything to 0", () => {
  assert.deepEqual(usageSnapshot(undefined), {
    promptTokens: 0, outputTokens: 0, thinkingTokens: 0,
    totalTokens: 0, outputImageTokens: 0, cachedTokens: 0,
  });
});

test("image batch estimate scales per image", () => {
  assert.ok(Math.abs(estimatedImageBatchCost(3) - 0.1008) < 1e-9);
});
