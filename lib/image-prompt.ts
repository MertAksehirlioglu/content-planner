import type { Post } from "@/lib/plan";
import { imageLayout, imageLayoutPrompt } from "./image-layout.ts";

export const DEFAULT_VISUAL_SYSTEM = [
  "premium editorial minimalism",
  "charcoal background (#111116)",
  "white modern sans-serif typography",
  "one restrained purple accent (#8B5CF6)",
  "generous spacing, strong grid, high contrast",
].join(", ");

/**
 * Variety without drift: the brand system is fixed, only the treatment rotates, and the
 * choice is a stable function of the post id — so every slide of one carousel matches and
 * two posts in the same week don't come back looking identical.
 */
const TREATMENTS = [
  "Treatment: soft directional key light, deep shadow falloff, close intimate framing.",
  "Treatment: even diffuse light, wide establishing framing, calm horizon-led composition.",
  "Treatment: raking low-angle light, strong geometric shadows, architectural framing.",
  "Treatment: bright airy light, shallow depth of field, single hero subject, clean backdrop.",
  "Treatment: cool ambient light, elevated top-down framing, ordered flat-lay geometry.",
];

function clean(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function treatment(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 100003;
  return TREATMENTS[hash % TREATMENTS.length];
}

function visualSystem(visualIdentity: string, avoid: string, post: Post): string {
  const brand = clean(visualIdentity, 800) || DEFAULT_VISUAL_SYSTEM;
  const forbidden = clean(avoid, 400);
  return [
    `STYLE LOCK: ${brand}.`,
    "Use the same palette, lighting, composition grid, accent treatment, and visual language on every slide.",
    treatment(post.id),
    forbidden ? `NEVER DEPICT: ${forbidden}. These are brand exclusions; treat them as forbidden subjects, props, and moods.` : "",
    "Leave generous negative space for a deterministic text overlay. No letters, words, numbers, logos, watermarks, or fake UI.",
    "Before finishing, scan the whole frame: any typography, watermark, logo, UI chrome, or object intruding on the reserved text zone is a failure — regenerate it away.",
  ].filter(Boolean).join(" ");
}

export function proposedImagePrompts(post: Post, visualIdentity: string, avoid = ""): string[] {
  const ratio = clean(post.aspect_ratio, 30) || "4:5 portrait";
  const concept = clean(post.concept, 240);
  const direction = clean(post.creative_brief, 500);

  if (post.format === "carousel" && post.slides.length) {
    const system = visualSystem(visualIdentity, avoid, post);
    return post.slides.map((slide, index) => {
      const layout = imageLayout(post, index);
      return [
        `Create a background/hero visual for carousel slide ${index + 1} of ${post.slides.length}, ${ratio}. Concept: ${concept}.`,
        system,
        imageLayoutPrompt(layout),
        `Visual: ${clean(slide.visual_direction, 400) || direction}.`,
        "Do not render any typography. The app will add the exact headline, supporting text, and page marker with Canvas.",
      ].join("\n");
    });
  }

  const layout = imageLayout(post, 0);
  return [[
    `Create one polished social-media image, ${ratio}. Concept: ${concept}.`,
    visualSystem(visualIdentity, avoid, post),
    imageLayoutPrompt(layout),
    `Visual: ${direction}.`,
    "No text or captions; typography will be added separately when needed. Avoid generic AI artifacts.",
  ].join("\n")];
}
