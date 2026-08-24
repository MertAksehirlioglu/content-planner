import { test } from "node:test";
import assert from "node:assert/strict";
import { BILLABLE_MODELS, costUsd, isBillableModel, monthKey, reserveUsd, usageSnapshot, type UsageSnapshot } from "./cost.ts";

const empty: UsageSnapshot = {
  promptTokens: 0, outputTokens: 0, thinkingTokens: 0,
  totalTokens: 0, outputImageTokens: 0, cachedTokens: 0,
};

test("text model bills input + (output+thinking)", () => {
  const usage = { ...empty, promptTokens: 1_000_000, outputTokens: 1_000_000, thinkingTokens: 0 };
  // gemini-3.6-flash: $0.75/M in + $3.75/M out
  assert.equal(costUsd("gemini-3.6-flash", usage), 0.75 + 3.75);
});

test("thinking tokens are billed as output", () => {
  const usage = { ...empty, thinkingTokens: 1_000_000 };
  assert.equal(costUsd("gemini-3.6-flash", usage), 3.75);
});

test("image model uses per-image fallback when no image tokens reported", () => {
  // gemini-3.1-flash-image fallback: $0.067/image, plus $0 tokens here
  assert.ok(Math.abs(costUsd("gemini-3.1-flash-image", empty, 2) - 0.134) < 1e-9);
});

test("unknown model throws rather than silently billing 0", () => {
  // A $0 charge never advances the budget counter, so an unrated model would be a free call.
  assert.throws(() => costUsd("made-up", empty, 5), /No rate for model made-up/);
});

test("every billable model has a rate", () => {
  for (const model of BILLABLE_MODELS) assert.doesNotThrow(() => costUsd(model, empty, 1));
  assert.equal(isBillableModel("made-up"), false);
});

test("usageSnapshot maps Gemini metadata and sums IMAGE-modality output tokens", () => {
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

test("usageSnapshot defaults everything to 0 when metadata is absent", () => {
  assert.deepEqual(usageSnapshot(undefined), {
    promptTokens: 0, outputTokens: 0, thinkingTokens: 0,
    totalTokens: 0, outputImageTokens: 0, cachedTokens: 0,
  });
});

test("monthKey is UTC YYYY-MM", () => {
  assert.equal(monthKey(new Date("2026-08-13T23:30:00Z")), "2026-08");
  assert.equal(monthKey(new Date("2026-01-01T00:00:00Z")), "2026-01");
});

test("every billable model has a reserve, and it covers a typical call", () => {
  for (const model of BILLABLE_MODELS) {
    const reserve = reserveUsd(model);
    assert.ok(reserve > 0, `${model} must hold something`);
    // A hold below the actual cost of a modest call would let concurrency through.
    const typical = costUsd(model, { ...empty, promptTokens: 8_000, outputTokens: 2_000 }, 1);
    assert.ok(reserve >= typical, `${model}: reserve ${reserve} < typical ${typical}`);
  }
});

test("reserveUsd refuses an unrated model", () => {
  assert.throws(() => reserveUsd("made-up"), /No reserve for model/);
});
