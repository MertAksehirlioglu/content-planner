import type { Post } from "@/lib/plan";

const MAX_FINGERPRINT = 620;

function compact(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

/** A small semantic record that preserves the dimensions useful for deduplication. */
export function postFingerprint(post: Post): string {
  const visualStructure = post.slides.length
    ? `${post.slides.length}-slide ${post.format}; ${post.slides.map((slide) => slide.visual_direction).filter(Boolean).slice(0, 2).join(" / ")}`
    : `${post.format}; ${post.creative_brief}`;
  return [
    `topic=${compact(post.category, 80)}`,
    `claim=${compact(post.concept, 150)}`,
    `angle=${compact(post.distinct_angle, 150)}`,
    `hook=${compact(post.hook, 120)}`,
    `channel=${post.platform}/${post.publisher}`,
    `visual=${compact(visualStructure, 170)}`,
  ].join(" | ").slice(0, MAX_FINGERPRINT);
}

function terms(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/** Rank exclusions against this week's context, then cap prompt growth. Recency is
 * preserved as the tie-break because callers pass newest entries first. */
export function selectRelevantFingerprints(
  history: string[], context: string, limit = 30,
): string[] {
  const wanted = terms(context);
  const unique = [...new Set(history.map((item) => compact(item, MAX_FINGERPRINT)).filter(Boolean))];
  return unique
    .map((item, index) => {
      const overlap = [...terms(item)].filter((term) => wanted.has(term)).length;
      return { item, index, score: overlap * 100 - index };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item);
}
