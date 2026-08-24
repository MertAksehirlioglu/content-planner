import type { Post } from "./plan.ts";

export type ImageTemplate = "editorial_split" | "lower_third" | "center_statement";
export type TextZone = "left" | "right" | "lower" | "center";

export interface ImageLayout {
  template: ImageTemplate;
  role: "cover" | "body" | "cta" | "standalone";
  textZone: TextZone;
  subjectZone: "left" | "right" | "upper" | "background";
  headlineScale: "large" | "medium";
}

export interface ImageOverlayCopy {
  headline: string;
  supportingText: string;
  marker: string;
}

/** Returns a brand accent only when it remains legible on the dark design surface. */
export function safeAccent(identity: string): string {
  const value = identity.match(/#[0-9a-f]{6}/i)?.[0];
  if (!value) return "#A78BFA";
  const channels = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return (luminance + .05) / .055 >= 3 ? value : "#A78BFA";
}

export function imageOverlayCopy(post: Post, index: number): ImageOverlayCopy {
  const slide = post.slides[index];
  return {
    headline: slide?.headline.trim() || post.overlay_text.trim() || post.hook.trim() || post.concept.trim(),
    supportingText: slide?.supporting_text.trim() || "",
    marker: post.format === "carousel" && post.slides.length > 1
      ? `${String(index + 1).padStart(2, "0")} / ${String(post.slides.length).padStart(2, "0")}` : "",
  };
}

export function imageLayout(post: Post, index: number): ImageLayout {
  const copy = imageOverlayCopy(post, index);
  if (post.format !== "carousel") {
    return { template: "lower_third", role: "standalone", textZone: "lower",
      subjectZone: "upper", headlineScale: "large" };
  }
  if (index === 0) {
    if (copy.headline.length + copy.supportingText.length > 105) {
      return { template: "lower_third", role: "cover", textZone: "lower",
        subjectZone: "upper", headlineScale: "large" };
    }
    return { template: "editorial_split", role: "cover", textZone: "left",
      subjectZone: "right", headlineScale: "large" };
  }
  const ctaLike = post.slides.length >= 4 && index === post.slides.length - 1
    || /\b(book|visit|learn|discover|contact|follow|save|share|start|try)\b/i.test(`${copy.headline} ${copy.supportingText}`);
  if (ctaLike) {
    return { template: "lower_third", role: "cta", textZone: "lower",
      subjectZone: "upper", headlineScale: "medium" };
  }
  const statementLike = copy.supportingText.length < 90
    && /[“”"]|\b\d+(?:[.,]\d+)?%?\b/.test(copy.headline);
  if (statementLike) {
    return { template: "center_statement", role: "body", textZone: "center",
      subjectZone: "background", headlineScale: "large" };
  }
  if (copy.headline.length + copy.supportingText.length > 82) {
    return { template: "lower_third", role: "body", textZone: "lower",
      subjectZone: "upper", headlineScale: "medium" };
  }
  const textZone = index % 2 === 1 ? "right" : "left";
  return { template: "editorial_split", role: "body", textZone,
    subjectZone: textZone === "left" ? "right" : "left", headlineScale: "medium" };
}

export function imageLayoutPrompt(layout: ImageLayout): string {
  const forbidden = " Do not draw any text container, card, panel, frame, box, banner, label, placeholder, or typography.";
  if (layout.template === "editorial_split") {
    return `LAYOUT CONTRACT: reserve the ${layout.textZone} 46% as calm, low-detail negative space. `
      + `Place the primary subject and strongest visual detail in the ${layout.subjectZone} 42%. `
      + `Do not let important objects cross into the reserved text zone.${forbidden}`;
  }
  if (layout.template === "lower_third") {
    return `LAYOUT CONTRACT: keep the primary subject in the upper 55%. Reserve the lower 38% as calm, low-detail negative space. Do not place faces or important objects in the lower text zone.${forbidden}`;
  }
  return `LAYOUT CONTRACT: use a balanced, symmetrical composition with subdued detail in the central 70%. Keep the edges visually active and the center calm.${forbidden}`;
}
