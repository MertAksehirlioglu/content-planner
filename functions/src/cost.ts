/** Authoritative server-side cost of one model call. Pure: no SDK, so node --test runs it.
 *  ponytail: rates mirror lib/cost.ts; keep them in sync by hand (4 rows, not worth a shared pkg). */

export interface UsageSnapshot {
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  outputImageTokens: number;
  cachedTokens: number;
}

/** Normalize Gemini's usageMetadata into the shape costUsd bills. Mirrors lib/cost.ts's
 *  usageSnapshot (same field names) so client display and server billing agree. */
export function usageSnapshot(metadata?: {
  promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number;
  totalTokenCount?: number; candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  cachedContentTokenCount?: number;
}): UsageSnapshot {
  const details = metadata?.candidatesTokensDetails ?? [];
  return {
    promptTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: metadata?.candidatesTokenCount ?? 0,
    thinkingTokens: metadata?.thoughtsTokenCount ?? 0,
    totalTokens: metadata?.totalTokenCount ?? 0,
    outputImageTokens: details.filter((x) => (x.modality ?? "").toUpperCase() === "IMAGE")
      .reduce((sum, x) => sum + (x.tokenCount ?? 0), 0),
    cachedTokens: metadata?.cachedContentTokenCount ?? 0,
  };
}

/** The only models the proxy will call. Deliberately the same list as the rate table below:
 *  a model with no rate bills $0, and a $0 bill never advances the budget counter, so an
 *  un-listed model is an unmetered call on the owner's API key. Adding a model here without
 *  adding its rate is the bug this pairing prevents. */
export const BILLABLE_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
] as const;

export function isBillableModel(model: string): boolean {
  return (BILLABLE_MODELS as readonly string[]).includes(model);
}

export function costUsd(model: string, usage: UsageSnapshot, imageCount = 0): number {
  const out = usage.outputTokens + usage.thinkingTokens;
  if (model === "gemini-3.6-flash") {
    return usage.promptTokens * 0.75 / 1_000_000 + out * 3.75 / 1_000_000;
  }
  if (model === "gemini-3.1-flash-lite") {
    return usage.promptTokens * 0.25 / 1_000_000 + out * 1.5 / 1_000_000;
  }
  if (model === "gemini-3.1-flash-image") {
    const imageUsd = usage.outputImageTokens
      ? usage.outputImageTokens * 60 / 1_000_000
      : imageCount * 0.067;
    return usage.promptTokens * 0.50 / 1_000_000
      + Math.max(0, out - usage.outputImageTokens) * 3 / 1_000_000
      + imageUsd;
  }
  if (model === "gemini-3.1-flash-lite-image") {
    return usage.promptTokens * 0.25 / 1_000_000
      + Math.max(0, out - usage.outputImageTokens) * 1.5 / 1_000_000
      + imageCount * 0.0336;
  }
  // Never return 0 for an unknown model: silent $0 is the wrong failure direction for money.
  // Callers gate on isBillableModel first, so reaching here means the two lists drifted.
  throw new Error(`No rate for model ${model} — add it to BILLABLE_MODELS and costUsd together.`);
}

/**
 * What to hold against the budget *before* a call, since the real cost is only knowable after.
 * Deliberately at or above a typical call: the hold is what stops N concurrent requests from
 * all reading the same pre-spend total and all passing the cap check. Too low and concurrency
 * still overshoots; too high and a legitimate user is refused with budget left. The settle step
 * refunds the difference either way, so erring high costs a user nothing but a slightly early
 * refusal at the very end of a month.
 */
export function reserveUsd(model: string): number {
  switch (model) {
    case "gemini-3.6-flash":            return 0.05;  // a full plan generation
    case "gemini-3.1-flash-lite":       return 0.01;  // rule derivation, much smaller
    case "gemini-3.1-flash-image":      return 0.10;  // one image + prompt tokens
    case "gemini-3.1-flash-lite-image": return 0.05;
    default:
      throw new Error(`No reserve for model ${model} — add it alongside its rate.`);
  }
}

export function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
