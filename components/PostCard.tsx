"use client";

import { useState, type CSSProperties } from "react";
import { Accordion, Alert, Badge, Button, Card, Checkbox, Group, Image, Menu, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { copyText } from "@/lib/clipboard";
import { estimatedImageBatchCost } from "@/lib/cost";
import { describeGenError } from "@/lib/errors";
import { downloadPngSlides } from "@/lib/export";
import { downloadCompositedImage, generateAiImage, proposedImagePrompts, type GeneratedImage } from "@/lib/image";
import { imageLayout, imageOverlayCopy, safeAccent } from "@/lib/image-layout";
import { type Post } from "@/lib/plan";
import { type SavedImageState } from "@/lib/week";
import { useEffect } from "react";

interface PostCardProps {
  post: Post;
  onTweak: () => void;
  onKeep: () => void;
  onBacklog: () => void;
  onTransform: (instruction: string) => void;
  visualIdentity: string;
  avoid: string;
  accountId?: string;
  onSpend: () => void;
  savedImageState?: SavedImageState;
  onImageState: (state: SavedImageState) => void;
  onGeneratedImages: (images: GeneratedImage[], state: Omit<SavedImageState, "images">) => Promise<void>;
}

function previewAspectRatio(value: string): string {
  const match = /^(\d+)\s*:\s*(\d+)$/.exec(value.trim());
  return match ? `${match[1]} / ${match[2]}` : "4 / 5";
}

function ImagePreview({ image, post, index, visualIdentity }: {
  image: GeneratedImage; post: Post; index: number; visualIdentity: string;
}) {
  const copy = imageOverlayCopy(post, index);
  const layout = imageLayout(post, index);
  const accent = safeAccent(visualIdentity);
  const overlayBackground = layout.template === "editorial_split"
    ? `linear-gradient(${layout.textZone === "left" ? "90deg" : "270deg"}, rgba(8,8,14,.96) 0%, rgba(8,8,14,.76) 48%, rgba(8,8,14,.16) 68%, transparent 100%)`
    : layout.template === "lower_third"
      ? "linear-gradient(180deg, transparent 38%, rgba(8,8,14,.68) 62%, rgba(8,8,14,.97) 100%)"
      : layout.template === "center_statement" ? "rgba(8,8,14,.72)" : "transparent";
  const textPosition: CSSProperties = layout.textZone === "left"
    ? { left: "8%", right: "52%", top: "17%", bottom: "17%" }
    : layout.textZone === "right" ? { left: "54%", right: "6%", top: "17%", bottom: "17%" }
      : layout.textZone === "center" ? { left: "14%", right: "14%", top: "29%", bottom: "29%", textAlign: "center" }
        : { left: "8%", right: "8%", top: "57%", bottom: "8%" };
  const objectPosition = layout.subjectZone === "right" ? "72% 50%"
    : layout.subjectZone === "left" ? "28% 50%" : layout.subjectZone === "upper" ? "50% 28%" : "50% 50%";
  const copyLength = copy.headline.length + copy.supportingText.length;
  const headlineCqw = copyLength > 110 ? 4.2 : copyLength > 70 ? 5 : copyLength > 38 ? 6 : 7.2;
  return <div style={{ position: "relative", aspectRatio: previewAspectRatio(post.aspect_ratio), overflow: "hidden",
    borderRadius: 8, marginTop: 4, background: "#111116", containerType: "inline-size" }}>
    <Image src={image.dataUrl} alt={`${post.concept} background ${index + 1}`} fit="cover"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectPosition }} />
    <div style={{ position: "absolute", inset: 0,
      background: overlayBackground,
      borderLeft: layout.template === "editorial_split" && layout.textZone === "left" ? `6px solid ${accent}` : undefined,
      borderRight: layout.template === "editorial_split" && layout.textZone === "right" ? `6px solid ${accent}` : undefined }} />
    <div style={{ position: "absolute", ...textPosition, color: "white", overflow: "hidden" }}>
      <div style={{ fontFamily: "Arial, sans-serif", fontSize: `clamp(.9rem, ${headlineCqw}cqw, 2rem)`,
        fontWeight: 700, lineHeight: 1.12, overflow: "hidden", display: "-webkit-box",
        WebkitBoxOrient: "vertical", WebkitLineClamp: layout.role === "cover" ? 4 : 3 }}>{copy.headline}</div>
      {copy.supportingText && <div style={{ marginTop: "5%", maxWidth: "96%", color: "rgba(255,255,255,.84)",
        fontFamily: "Arial, sans-serif", fontSize: "clamp(.7rem, 3.1cqw, 1rem)", lineHeight: 1.3,
        overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3 }}>
        {copy.supportingText}
      </div>}
    </div>
    {copy.marker && <div style={{ position: "absolute", right: "7%", bottom: "5%", color: accent,
      fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize: ".72rem", letterSpacing: ".05em" }}>
      {copy.marker}
    </div>}
  </div>;
}

export function PostCard({ post, onTweak, onKeep, onBacklog, onTransform, visualIdentity, avoid, accountId, onSpend,
  savedImageState, onImageState, onGeneratedImages }: PostCardProps) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [imageStage, setImageStage] = useState<"idle" | "proposed" | "generated" | "accepted">(savedImageState?.stage ?? "idle");
  const [imagePrompts, setImagePrompts] = useState<string[]>(savedImageState?.prompts ?? []);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>(() => (savedImageState?.images ?? []).map((image) => ({
    dataUrl: image.url, mimeType: image.mimeType, model: image.model, usage: image.usage,
  })));
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [retryNote, setRetryNote] = useState("");
  const [retryCount, setRetryCount] = useState(savedImageState?.retryCount ?? 0);
  const [selectedSlides, setSelectedSlides] = useState<number[]>([]);
  const [reuseFirstVisual, setReuseFirstVisual] = useState(savedImageState?.reuseFirstVisual ?? false);

  // Image chunks are loaded after the week document. Keep local display state
  // synchronized when that hydrated state arrives instead of relying solely on
  // useState's one-time initializer.
  useEffect(() => {
    setImageStage(savedImageState?.stage ?? "idle");
    setImagePrompts(savedImageState?.prompts ?? []);
    setRetryCount(savedImageState?.retryCount ?? 0);
    setReuseFirstVisual(savedImageState?.reuseFirstVisual ?? false);
    setGeneratedImages((savedImageState?.images ?? []).map((image) => ({
      dataUrl: image.url, mimeType: image.mimeType, model: image.model, usage: image.usage,
    })));
  }, [savedImageState]);

  const canGenerateImage = post.format === "single_image" || post.format === "carousel"
    || post.format === "reel" || post.creative_type === "ai_image";
  const hashtags = post.hashtags.join(" ");
  const hasVisualProduction = post.format !== "text" && (
    Boolean(post.creative_brief.trim()) || Boolean(post.overlay_text.trim()) || post.slides.length > 0
  );
  const hasProductionNotes = hasVisualProduction || post.facts_to_verify.length > 0 || post.assumptions.length > 0;

  async function copy() {
    await copyText(`${post.caption}\n\n${hashtags}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function prepareImage() {
    const prompts = proposedImagePrompts(post, visualIdentity, avoid);
    setImagePrompts(prompts);
    setGeneratedImages([]); setRetryCount(0); setRetryNote(""); setImageError("");
    setSelectedSlides(prompts.map((_, index) => index));
    setImageStage("proposed");
    onImageState({ stage: "proposed", prompts, retryCount: 0, images: [], reuseFirstVisual });
  }

  async function runImageGeneration(indexes: number[], isRetry = false) {
    const targets = [...new Set(indexes)].filter((index) => index >= 0 && index < imagePrompts.length).sort((a, b) => a - b);
    if (!targets.length) return;
    setImageBusy(true); setImageError("");
    try {
      const working: Array<GeneratedImage | undefined> = generatedImages.length === imagePrompts.length
        ? [...generatedImages] : Array.from({ length: imagePrompts.length });
      const actualTargets = reuseFirstVisual && generatedImages.length === 0 ? [0] : targets;
      for (const index of actualTargets) {
        // A raw first-slide background is the style reference; browser-rendered text is never
        // sent back to the image model.
        const styleReference = index === 0 ? undefined : working[0];
        const image = await generateAiImage(imagePrompts[index], isRetry ? retryNote : "",
          styleReference, post.aspect_ratio, accountId);
        working[index] = image;
        onSpend();
      }
      if (reuseFirstVisual && generatedImages.length === 0 && working[0]) {
        for (let index = 1; index < working.length; index += 1) working[index] = working[0];
      }
      if (working.some((image) => !image)) throw new Error("Generate the missing slide backgrounds before retrying a selection.");
      const images = working as GeneratedImage[];
      const nextRetryCount = retryCount + (isRetry ? 1 : 0);
      await onGeneratedImages(images, { stage: "generated", prompts: imagePrompts,
        retryCount: nextRetryCount, reuseFirstVisual });
      setGeneratedImages(images); setImageStage("generated"); setRetryNote("");
      if (isRetry) setRetryCount(nextRetryCount);
    } catch (err) { setImageError(describeGenError(err)); }
    finally { setImageBusy(false); }
  }

  async function downloadImage(index: number) {
    const image = generatedImages[index];
    if (!image) return;
    try {
      const copy = imageOverlayCopy(post, index);
      const layout = imageLayout(post, index);
      await downloadCompositedImage(image, `${post.id}-${String(index + 1).padStart(2, "0")}`,
        copy.headline, copy.supportingText, copy.marker, visualIdentity, post.aspect_ratio, layout);
    } catch (err) { setImageError((err as Error).message); }
  }

  async function downloadImages(indexes: number[]) {
    for (const index of indexes) {
      await downloadImage(index);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  const spine = post.platform === "instagram" ? "var(--amber)" : "var(--iris)";
  return (
    <Card withBorder radius="lg" padding="lg" className="postCard" style={{ "--spine": spine } as CSSProperties}>
      <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
        <span className="dayTab">{post.day}</span>
        <Group gap={6} justify="flex-end">
          <Badge variant="light" color={post.platform === "instagram" ? "orange" : "iris"}>{post.platform}</Badge>
          <Badge variant="outline">{post.publisher}</Badge>
          <Badge variant="light" color="gray">{post.category}</Badge>
          <Badge variant="default">{post.format.replace("_", " ")}</Badge>
        </Group>
      </Group>

      <Text className="eyebrow">{post.objective}</Text>
      <Text fw={600} size="lg" mt={6}
        style={{ fontFamily: "var(--font-display), sans-serif", lineHeight: 1.25 }}>{post.hook}</Text>
      <Text className="caption" mt="xs">{post.caption}</Text>
      {post.cta && <Text size="sm" mt="xs"><b>CTA:</b> {post.cta}</Text>}
      <Text c="indigo" size="sm" mt="xs" style={{ wordBreak: "break-word" }}>
        {hashtags}
      </Text>
      {hasProductionNotes && <Accordion mt="sm" variant="contained">
        <Accordion.Item value="production-details">
          <Accordion.Control>{hasVisualProduction ? "Creative direction" : "Notes"}</Accordion.Control>
          <Accordion.Panel>
            {hasVisualProduction && post.creative_brief.trim() && <Text c="dimmed" size="sm" pl="sm" style={{ borderLeft: "2px solid var(--mantine-color-dark-4)" }}>
              {post.creative_brief}
            </Text>}
            {hasVisualProduction && post.overlay_text && <Text size="sm" mt="xs"><b>Overlay:</b> {post.overlay_text}</Text>}
            {hasVisualProduction && post.slides.length > 0 && <Stack gap={4} mt="xs">
              {post.slides.map((slide, i) => <Text size="sm" key={i}><b>Slide {i + 1}:</b> {slide.headline}{slide.supporting_text ? ` — ${slide.supporting_text}` : ""}</Text>)}
            </Stack>}
            {post.facts_to_verify.length > 0 && <Alert color="yellow" mt="sm" title="Verify before publishing">
              {post.facts_to_verify.join(" · ")}
            </Alert>}
            {post.assumptions.length > 0 && <Alert color="blue" mt="sm" title="Creative assumptions">
              {post.assumptions.join(" · ")}
            </Alert>}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>}

      {canGenerateImage && imageStage === "idle" && (
        <Button mt="sm" variant="light" onClick={prepareImage}>Create image with AI</Button>
      )}
      {canGenerateImage && imageStage !== "idle" && (
        <Card withBorder mt="sm" padding="sm">
          <Group justify="space-between">
            <Text fw={600} size="sm">AI image proposal</Text>
            <Badge color={imageStage === "accepted" ? "green" : "gray"}>
              {imageStage === "accepted" ? "Accepted" : `${retryCount}/3 retries used`}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            Review the background prompts below. Carousel copy and page numbers are rendered exactly in the browser, so the image model never typesets them. No image request is made until you confirm.
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Estimated generation cost: ~${estimatedImageBatchCost(reuseFirstVisual ? 1 : imagePrompts.length).toFixed(2)}. Images are always generated at 1K.
          </Text>
          {imagePrompts.length > 1 && imageStage === "proposed" && (
            <Switch mt="xs" checked={reuseFirstVisual} label="Reuse slide 1 background across the carousel"
              description="Generates one visual instead of one per slide; the exact text still changes per slide."
              onChange={(event) => setReuseFirstVisual(event.currentTarget.checked)} />
          )}
          <Stack gap="xs" mt="xs">
            {imagePrompts.map((prompt, index) => (
              <Textarea key={index} label={imagePrompts.length > 1 ? `Slide ${index + 1} prompt` : "Image prompt"}
                autosize minRows={5} value={prompt} disabled={imageStage === "accepted"}
                onChange={(event) => setImagePrompts((current) => {
                  const prompts = current.map((value, promptIndex) => promptIndex === index ? event.currentTarget.value : value);
                  onImageState({ stage: imageStage, prompts, retryCount, images: savedImageState?.images ?? [],
                    reuseFirstVisual });
                  return prompts;
                })} />
            ))}
          </Stack>
          {imageStage === "proposed" && (
            <Group mt="xs">
              <Button loading={imageBusy} disabled={imagePrompts.some((prompt) => !prompt.trim())}
                onClick={() => void runImageGeneration(imagePrompts.map((_, index) => index))}>
                Generate {reuseFirstVisual ? "1 background" : imagePrompts.length > 1 ? `${imagePrompts.length} backgrounds` : "image"}
              </Button>
              <Button variant="subtle" onClick={() => { setImageStage("idle"); onImageState({ stage: "idle", prompts: [], retryCount: 0, images: [] }); }}>Cancel</Button>
            </Group>
          )}
          {generatedImages.length > 0 && (
            <SimpleGrid cols={{ base: 1, sm: generatedImages.length > 1 ? 2 : 1 }} mt="sm">
              {generatedImages.map((image, index) => (
                <div key={index}>
                  <Group justify="space-between" gap="xs">
                    <Checkbox size="xs" checked={selectedSlides.includes(index)}
                      label={generatedImages.length > 1 ? `Slide ${index + 1}` : "Image"}
                      onChange={(event) => setSelectedSlides((current) => event.currentTarget.checked
                        ? [...new Set([...current, index])].sort((a, b) => a - b)
                        : current.filter((value) => value !== index))} />
                  </Group>
                  <ImagePreview image={image} post={post} index={index} visualIdentity={visualIdentity} />
                  {generatedImages.length > 1 && imageStage === "generated" && (
                    <Button mt={6} size="compact-xs" variant="subtle" loading={imageBusy} disabled={retryCount >= 3}
                      onClick={() => void runImageGeneration([index], true)}>Retry this slide</Button>
                  )}
                </div>
              ))}
            </SimpleGrid>
          )}
          {imageStage === "generated" && generatedImages.length > 0 && (
            <>
              <TextInput mt="xs" label="Optional retry refinement" value={retryNote}
                onChange={(event) => setRetryNote(event.currentTarget.value)}
                placeholder="e.g. Warmer dusk light, less furniture, wider framing." />
              <Group mt="xs">
                <Button color="green" onClick={() => { setImageStage("accepted"); onImageState({
                  stage: "accepted", prompts: imagePrompts, retryCount, images: savedImageState?.images ?? [],
                  reuseFirstVisual,
                }); }}>Accept {generatedImages.length > 1 ? "images" : "image"}</Button>
                <Button variant="default" onClick={() => void downloadImages(generatedImages.map((_, index) => index))}>
                  Download all
                </Button>
                <Button variant="default" loading={imageBusy} disabled={retryCount >= 3}
                  onClick={() => void runImageGeneration(selectedSlides, true)}>
                  Retry selected{retryCount >= 3 ? " — limit reached" : ` (${3 - retryCount} left)`}
                </Button>
                {generatedImages.length > 1 && <Button variant="default" loading={imageBusy} disabled={retryCount >= 3}
                  onClick={() => void runImageGeneration(generatedImages.map((_, index) => index), true)}>
                  Retry entire carousel
                </Button>}
              </Group>
            </>
          )}
          {imageStage === "accepted" && generatedImages.length > 0 && (
            <Group mt="xs">
              <Button variant="default" onClick={() => void downloadImages(generatedImages.map((_, index) => index))}>
                Download accepted {generatedImages.length > 1 ? "slides" : "image"}
              </Button>
            </Group>
          )}
          {imageError && <Alert color="red" mt="xs">{imageError}</Alert>}
        </Card>
      )}

      <Group gap="xs" mt="md">
        <Button size="compact-sm" variant="default" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy caption"}
        </Button>
        <Menu>
          <Menu.Target><Button size="compact-sm" variant="default">Transform</Button></Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={onTweak}>Write a custom change below</Menu.Item>
            <Menu.Divider />
            {[
              ["Shorten caption", "Shorten the caption while preserving its strongest idea."],
              ["Stronger hook", "Replace only the hook with a sharper, specific opening."],
              ["Founder version", "Adapt this into a credible first-person LinkedIn founder post."],
              ["LinkedIn version", "Adapt this for a LinkedIn company post with a distinct channel-native angle."],
              ["Repost caption", "Turn this into a concise founder repost caption that adds personal context."],
              ["Grammar cleanup", "Correct grammar and clarity issues without changing the meaning, claims, or voice."],
              ["Better hashtags", "Replace only the hashtags with a smaller set of specific, relevant hashtags."],
              ["New creative", "Keep the strategy and caption, but replace the creative direction."],
            ].map(([label, instruction]) => <Menu.Item key={label} onClick={() => onTransform(instruction)}>{label}</Menu.Item>)}
            <Menu.Divider />
            <Menu.Item onClick={() => {
              const instruction = window.prompt("What should change in this post?")?.trim();
              if (instruction) onTransform(instruction);
            }}>Custom change…</Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Menu>
          <Menu.Target><Button size="compact-sm" variant="default">Save & export</Button></Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={onKeep}>Add to workflow</Menu.Item>
            <Menu.Item onClick={onBacklog}>Save to backlog</Menu.Item>
            {(post.format === "carousel" || post.format === "single_image") && <>
            <Menu.Divider />
            <Menu.Item disabled={exporting} onClick={() => {
              setExporting(true); setExportError("");
              void downloadPngSlides(post, visualIdentity)
                .catch((err) => setExportError((err as Error).message))
                .finally(() => setExporting(false));
            }}>Download PNG slides</Menu.Item>
            </>}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {exportError && <Text size="xs" c="red" mt="xs">Couldn&rsquo;t export: {exportError}</Text>}
    </Card>
  );
}
