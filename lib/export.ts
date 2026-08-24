import type { Plan, Post, Strategy } from "@/lib/plan";

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "content-plan";
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(strategy: Strategy, plan: Plan): void {
  download(new Blob([JSON.stringify({ strategy, plan }, null, 2)], { type: "application/json" }),
    `${safeName(plan.week_theme)}.json`);
}

export function planMarkdown(strategy: Strategy, plan: Plan): string {
  const sections = plan.posts.map((post) => {
    const hasVisual = post.format !== "text";
    const slides = post.slides.map((slide, index) =>
      `- Slide ${index + 1}: **${slide.headline}**${slide.supporting_text ? ` — ${slide.supporting_text}` : ""}\n  - Visual: ${slide.visual_direction}`,
    ).join("\n");
    return `## ${post.day}: ${post.concept}\n\n` +
      `- Channel: ${post.platform} / ${post.publisher}\n- Objective: ${post.objective}\n` +
      `- Format: ${post.format}\n${hasVisual && post.source_asset ? `- Source asset: ${post.source_asset}\n` : ""}${hasVisual && post.aspect_ratio ? `- Aspect ratio: ${post.aspect_ratio}\n` : ""}\n` +
      `### Caption\n\n${post.caption}\n\n${post.cta ? `CTA: ${post.cta}\n\n` : ""}` +
      `${post.hashtags.join(" ")}\n\n${hasVisual && post.creative_brief ? `### Creative direction\n\n${post.creative_brief}\n\n` : ""}` +
      `${post.overlay_text ? `Overlay: ${post.overlay_text}\n\n` : ""}${slides ? `### Slides\n\n${slides}\n\n` : ""}` +
      `${post.facts_to_verify.length ? `### Verify before publishing\n\n${post.facts_to_verify.map((x) => `- ${x}`).join("\n")}\n` : ""}`;
  });
  return `# ${plan.week_theme}\n\n${strategy.rationale}\n\n${sections.join("\n---\n\n")}`;
}

export function downloadMarkdown(strategy: Strategy, plan: Plan): void {
  download(new Blob([planMarkdown(strategy, plan)], { type: "text/markdown;charset=utf-8" }),
    `${safeName(plan.week_theme)}.md`);
}

function accentFrom(identity: string): string {
  return identity.match(/#[0-9a-f]{6}/i)?.[0].slice(1).toUpperCase() ?? "D232A9";
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrapped(context: CanvasRenderingContext2D, text: string, x: number, y: number,
  maxWidth: number, lineHeight: number): number {
  const lines = wrapLines(context, text, maxWidth);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not render this PNG.")), "image/png",
  ));
}

/** Render ready-to-upload 1080×1350 PNGs. Visual-direction notes stay out of the artwork. */
export async function downloadPngSlides(post: Post, visualIdentity: string): Promise<void> {
  const accent = `#${accentFrom(visualIdentity)}`;
  const frames = post.slides.length ? post.slides : [{
    headline: post.overlay_text || post.hook, supporting_text: "", visual_direction: post.creative_brief,
  }];
  for (const [index, frame] of frames.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1350;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available in this browser.");
    context.fillStyle = "#111116"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = accent; context.fillRect(0, 0, 22, canvas.height);
    context.textBaseline = "top";
    context.fillStyle = accent; context.font = "700 22px Arial";
    context.fillText(post.platform.toUpperCase(), 88, 80);
    context.fillStyle = "#FFFFFF"; context.font = "700 68px Arial";
    const afterHeadline = drawWrapped(context, frame.headline, 88, 285, 890, 82);
    if (frame.supporting_text) {
      context.fillStyle = "#D0D0D6"; context.font = "400 36px Arial";
      drawWrapped(context, frame.supporting_text, 88, afterHeadline + 55, 850, 48);
    }
    context.fillStyle = accent; context.font = "700 20px Arial"; context.textAlign = "right";
    context.fillText(`${String(index + 1).padStart(2, "0")} / ${String(frames.length).padStart(2, "0")}`, 980, 1240);
    context.textAlign = "left";
    const blob = await canvasBlob(canvas);
    download(blob, `${safeName(post.concept)}-${String(index + 1).padStart(2, "0")}.png`);
    // Give browsers time to register consecutive downloads.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}
