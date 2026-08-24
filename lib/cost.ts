/**
 * Client-side usage display only. The *authoritative* cost of a call is computed on the
 * server in functions/src/cost.ts and written to the spend counter there — nothing here
 * bills anyone, so nothing here needs the full rate table. It used to carry a copy of that
 * table (`estimateCost`), which was dead code the moment metering moved server-side and a
 * standing invitation for the two to drift.
 */

export interface UsageSnapshot {
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  outputImageTokens: number;
  cachedTokens: number;
}

/**
 * Normalize Gemini's usageMetadata. Every field is optional because this is untrusted model
 * output: a response that omits `modality` or `tokenCount` must produce a zero, not throw
 * inside the usage panel. Mirrors the guards in functions/src/cost.ts.
 */
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

/** Shown before the user confirms an image batch, so it must be a pre-flight guess rather than
 *  a reading of usageMetadata. Matches the per-image fallback the server bills for
 *  gemini-3.1-flash-lite-image; the server's number is the one that counts. */
export function estimatedImageBatchCost(count: number): number {
  return count * 0.0336;
}
