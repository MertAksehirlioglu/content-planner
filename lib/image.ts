import { usageSnapshot, type UsageSnapshot } from "@/lib/cost";
import { callGenerate, type GeminiPart } from "@/lib/generate-client";
import { safeAccent, type ImageLayout } from "@/lib/image-layout";
export { proposedImagePrompts } from "@/lib/image-prompt";

const IMAGE_MODEL = "gemini-3.1-flash-lite-image";

// Aspect ratios Gemini's image model accepts (same set the canvas below can compose).
const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9",
]);
function resolveAspectRatio(value: string): string {
  const cleaned = value.replace(/\s+/g, "");
  return SUPPORTED_ASPECT_RATIOS.has(cleaned) ? cleaned : "4:5";
}

export interface GeneratedImage { dataUrl: string; mimeType: string; usage: UsageSnapshot; model: string }

export async function generateAiImage(
  prompt: string,
  refinement = "",
  styleReference?: GeneratedImage,
  aspectRatio = "4:5",
  accountId?: string,
): Promise<GeneratedImage> {
  const request = refinement
    ? `${prompt}\n\nRetry refinement: ${refinement}\nGenerate a meaningfully improved new version.`
    : prompt;
  // Declare what the attached image is FOR. Left implicit, the model copies its subject
  // instead of its style and every slide comes back as a variation of slide one.
  const parts: GeminiPart[] = styleReference ? [
    { text: `${request}\nATTACHED IMAGE — ROLE: style reference only. Match its palette, lighting, `
      + "material language, and composition grid exactly. Do not reuse its subject, objects, or scene; "
      + "this slide keeps its own visual direction above." },
    { inlineData: { data: styleReference.dataUrl.slice(styleReference.dataUrl.indexOf(",") + 1), mimeType: styleReference.mimeType } },
  ] : [{ text: request }];
  const res = await callGenerate({
    model: IMAGE_MODEL, parts,
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: { aspectRatio: resolveAspectRatio(aspectRatio), imageSize: "1K" },
    operation: "image", accountId,
  });
  if (!res.inlineData?.data) throw new Error("The image model returned no image. The prompt may have been filtered.");
  const mimeType = res.inlineData.mimeType || "image/png";
  return {
    dataUrl: `data:${mimeType};base64,${res.inlineData.data}`, mimeType,
    usage: usageSnapshot(res.usageMetadata),
    model: IMAGE_MODEL,
  };
}

function wrapLines(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  const words = value.trim().split(/\s+/).flatMap((word) => {
    if (context.measureText(word).width <= maxWidth) return [word];
    const pieces: string[] = [];
    let piece = "";
    for (const character of word) {
      if (piece && context.measureText(piece + character).width > maxWidth) {
        pieces.push(piece); piece = character;
      } else piece += character;
    }
    if (piece) pieces.push(piece);
    return pieces;
  });
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || context.measureText(candidate).width <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

function cappedLines(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number): string[] {
  const lines = wrapLines(context, value, maxWidth);
  if (lines.length <= maxLines) return lines;
  const capped = lines.slice(0, maxLines);
  let last = `${capped[maxLines - 1]}…`;
  while (last.length > 1 && context.measureText(last).width > maxWidth) last = `${last.slice(0, -2)}…`;
  capped[maxLines - 1] = last;
  return capped;
}

interface FittedTextBlock {
  headlineLines: string[]; headlineSize: number;
  supportingLines: string[]; supportingSize: number; gap: number;
}

function fitTextBlock(context: CanvasRenderingContext2D, headline: string, supportingText: string,
  maxWidth: number, maxHeight: number, maxHeadlineSize: number, minHeadlineSize: number,
  maxHeadlineLines: number, unit: number): FittedTextBlock {
  const maxSupportingLines = 3;
  for (let headlineSize = maxHeadlineSize; headlineSize >= minHeadlineSize; headlineSize -= 2) {
    context.font = `700 ${headlineSize}px Arial`;
    const headlineLines = wrapLines(context, headline, maxWidth);
    const supportingSize = Math.max(22 * unit, Math.min(32 * unit, headlineSize * .43));
    context.font = `400 ${supportingSize}px Arial`;
    const supportingLines = supportingText ? wrapLines(context, supportingText, maxWidth) : [];
    const gap = supportingLines.length ? 24 * unit : 0;
    const height = headlineLines.length * headlineSize * 1.14 + gap
      + supportingLines.length * supportingSize * 1.32;
    if (headlineLines.length <= maxHeadlineLines && supportingLines.length <= maxSupportingLines
      && height <= maxHeight) return { headlineLines, headlineSize, supportingLines, supportingSize, gap };
  }
  context.font = `700 ${minHeadlineSize}px Arial`;
  const headlineLines = cappedLines(context, headline, maxWidth, maxHeadlineLines);
  const supportingSize = 22 * unit;
  context.font = `400 ${supportingSize}px Arial`;
  const supportingLines = supportingText ? cappedLines(context, supportingText, maxWidth, maxSupportingLines) : [];
  return { headlineLines, headlineSize: minHeadlineSize, supportingLines, supportingSize,
    gap: supportingLines.length ? 20 * unit : 0 };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The generated background could not be rendered."));
    image.src = url;
  });
}

function canvasDimensions(aspectRatio: string): [number, number] {
  const dimensions: Record<string, [number, number]> = {
    "1:1": [1080, 1080], "2:3": [1080, 1620], "3:2": [1620, 1080],
    "3:4": [1080, 1440], "4:3": [1440, 1080], "4:5": [1080, 1350],
    "5:4": [1350, 1080], "9:16": [1080, 1920], "16:9": [1920, 1080],
  };
  return dimensions[aspectRatio.replace(/\s+/g, "")] ?? dimensions["4:5"];
}

/** Combines a generated background with exact browser-rendered post copy. */
export async function downloadCompositedImage(
  image: GeneratedImage, filename: string, headline: string, supportingText: string,
  marker: string, visualIdentity: string, aspectRatio: string, layout: ImageLayout,
): Promise<void> {
  const source = await loadImage(image.dataUrl);
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = canvasDimensions(aspectRatio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  const scale = Math.max(canvas.width / source.naturalWidth, canvas.height / source.naturalHeight);
  const width = source.naturalWidth * scale;
  const height = source.naturalHeight * scale;
  const drawX = layout.subjectZone === "right" ? canvas.width - width
    : layout.subjectZone === "left" ? 0 : (canvas.width - width) / 2;
  const drawY = layout.subjectZone === "upper" ? 0 : (canvas.height - height) / 2;
  context.drawImage(source, drawX, drawY, width, height);
  const unit = Math.min(canvas.width / 1080, canvas.height / 1350);
  let x = canvas.width * .08;
  let y = canvas.height * .17;
  let maxWidth = canvas.width * .44;
  let maxHeight = canvas.height * .66;
  let textAlign: CanvasTextAlign = "left";
  if (layout.template === "editorial_split") {
    const from = layout.textZone === "left" ? 0 : canvas.width;
    const to = layout.textZone === "left" ? canvas.width : 0;
    const gradient = context.createLinearGradient(from, 0, to, 0);
    gradient.addColorStop(0, "rgba(8,8,14,.92)"); gradient.addColorStop(.48, "rgba(8,8,14,.68)");
    gradient.addColorStop(.66, "rgba(8,8,14,.10)"); gradient.addColorStop(1, "rgba(8,8,14,0)");
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
    if (layout.textZone === "right") x = canvas.width * .54;
  } else if (layout.template === "lower_third") {
    const gradient = context.createLinearGradient(0, canvas.height * .38, 0, canvas.height);
    gradient.addColorStop(0, "rgba(8,8,14,0)"); gradient.addColorStop(.34, "rgba(8,8,14,.68)");
    gradient.addColorStop(1, "rgba(8,8,14,.97)");
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
    x = canvas.width * .08; y = canvas.height * .57; maxWidth = canvas.width * .84;
    maxHeight = canvas.height * .31;
  } else {
    context.fillStyle = "rgba(8,8,14,.72)"; context.fillRect(0, 0, canvas.width, canvas.height);
    x = canvas.width * .5; y = canvas.height * .29; maxWidth = canvas.width * .72;
    maxHeight = canvas.height * .42; textAlign = "center";
  }
  const accent = safeAccent(visualIdentity);
  context.fillStyle = accent;
  if (layout.template === "editorial_split") {
    const barX = layout.textZone === "right" ? canvas.width - 18 * unit : 0;
    context.fillRect(barX, 0, 18 * unit, canvas.height);
  }
  context.textBaseline = "top";
  context.textAlign = textAlign;
  const fitted = fitTextBlock(context, headline, supportingText, maxWidth, maxHeight,
    (layout.headlineScale === "large" ? 72 : 60) * unit, 34 * unit,
    layout.role === "cover" ? 4 : 3, unit);
  context.fillStyle = "#FFFFFF"; context.font = `700 ${fitted.headlineSize}px Arial`;
  for (const line of fitted.headlineLines) {
    context.fillText(line, x, y); y += fitted.headlineSize * 1.14;
  }
  if (fitted.supportingLines.length) {
    y += fitted.gap;
    context.fillStyle = "rgba(255,255,255,.84)"; context.font = `400 ${fitted.supportingSize}px Arial`;
    for (const line of fitted.supportingLines) {
      context.fillText(line, x, y); y += fitted.supportingSize * 1.32;
    }
  }
  if (marker) {
    context.fillStyle = accent; context.font = `700 ${22 * unit}px Arial`;
    context.textAlign = "right"; context.fillText(marker, canvas.width * .92, canvas.height * .93);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("The browser could not render this slide.")), "image/png",
  ));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${filename.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase()}.png`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
