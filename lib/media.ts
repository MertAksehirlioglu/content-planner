import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { GeneratedImage } from "@/lib/image";
import type { SavedImage, SavedImageState } from "@/lib/week";

// Firestore documents are capped at 1 MiB. Base64 is split conservatively so full-quality
// images can be retained without requiring a separately provisioned Storage bucket.
const CHUNK_SIZE = 700_000;

function assetDoc(uid: string, accountId: string, weekKey: string, assetId: string) {
  return doc(db, "users", uid, "accounts", accountId, "weeks", weekKey, "media", assetId);
}

function mediaCol(uid: string, accountId: string, weekKey: string) {
  return collection(db, "users", uid, "accounts", accountId, "weeks", weekKey, "media");
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-");
}

async function hydrateImage(image: SavedImage): Promise<SavedImage> {
  if (!image.path) return image;
  const chunks = await getDocs(collection(doc(db, image.path), "chunks"));
  const url = chunks.docs.sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => String(entry.data().data ?? "")).join("");
  return { ...image, url };
}

export async function saveWeekImages(uid: string, accountId: string, weekKey: string,
  postId: string, images: GeneratedImage[]): Promise<SavedImage[]> {
  const savedByData = new Map<string, SavedImage>();
  const saved: SavedImage[] = [];
  for (const [index, image] of images.entries()) {
    const assetId = `${postId}-${index + 1}`.replace(/[^a-z0-9-]/gi, "-");
    const asset = assetDoc(uid, accountId, weekKey, assetId);
    const existing = await getDocs(collection(asset, "chunks"));
    await Promise.all(existing.docs.map((entry) => deleteDoc(entry.ref)));
    const duplicate = savedByData.get(image.dataUrl);
    if (duplicate) {
      // Reused carousel backgrounds point at one media asset instead of storing the
      // same base64 bytes once per slide. Remove any stale per-slide asset metadata.
      await deleteDoc(asset).catch(() => undefined);
      saved.push(duplicate);
      continue;
    }
    const chunks = Array.from({ length: Math.ceil(image.dataUrl.length / CHUNK_SIZE) }, (_, i) =>
      image.dataUrl.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    await setDoc(asset, { postId, index, mimeType: image.mimeType, model: image.model,
      usage: image.usage, chunkCount: chunks.length });
    await Promise.all(chunks.map((data, i) => setDoc(doc(collection(asset, "chunks"), String(i).padStart(5, "0")), { data })));
    const stored = { url: image.dataUrl, path: asset.path, mimeType: image.mimeType, model: image.model, usage: image.usage };
    savedByData.set(image.dataUrl, stored);
    saved.push(stored);
  }
  return saved;
}

export async function hydrateWeekImages(states: Record<string, SavedImageState>,
  expectedMediaPrefix = ""): Promise<Record<string, SavedImageState>> {
  const hydrated = await Promise.all(Object.entries(states).map(async ([postId, state]) => {
    // A manifest must never be allowed to follow an asset path into another
    // account or week, even if a stale async UI update wrote one there.
    const scopedImages = expectedMediaPrefix
      ? state.images.filter((image) => image.path.startsWith(expectedMediaPrefix)) : state.images;
    const images = await Promise.all(scopedImages.map(hydrateImage));
    return [postId, { ...state, images }] as const;
  }));
  return Object.fromEntries(hydrated);
}

/** Recover media written before its week manifest was saved. This is deliberately
 * limited to post ids in the loaded plan so unrelated/stale assets stay hidden. */
export async function recoverWeekImages(uid: string, accountId: string, weekKey: string,
  states: Record<string, SavedImageState>, postIds: string[]): Promise<Record<string, SavedImageState>> {
  const recovered = { ...states };
  const assets = await getDocs(mediaCol(uid, accountId, weekKey));
  const emptyUsage = { promptTokens: 0, cachedTokens: 0, outputTokens: 0,
    thinkingTokens: 0, totalTokens: 0, outputImageTokens: 0 };

  for (const postId of postIds) {
    if (recovered[postId]?.images.some((image) => image.url)) continue;
    const prefix = `${safeId(postId)}-`;
    const matches = assets.docs.filter((entry) =>
      entry.data().postId === postId || entry.id.startsWith(prefix));
    const images = (await Promise.all(matches.map(async (entry) => {
      const data = entry.data();
      const index = typeof data.index === "number"
        ? data.index : Number(entry.id.slice(prefix.length)) - 1;
      const image = await hydrateImage({
        url: "", path: entry.ref.path, mimeType: String(data.mimeType ?? "image/png"),
        model: String(data.model ?? "saved-image"), usage: data.usage ?? emptyUsage,
      });
      return { index, image };
    }))).filter(({ image }) => image.url).sort((a, b) => a.index - b.index).map(({ image }) => image);
    if (!images.length) continue;
    const prior = recovered[postId];
    recovered[postId] = { stage: prior?.stage === "accepted" ? "accepted" : "generated",
      prompts: prior?.prompts ?? [], retryCount: prior?.retryCount ?? 0, images,
      reuseFirstVisual: prior?.reuseFirstVisual };
  }
  return recovered;
}

export async function deleteWeekImages(states: Record<string, SavedImageState>): Promise<void> {
  const paths = [...new Set(Object.values(states).flatMap((state) =>
    state.images.map((image) => image.path).filter(Boolean)))];
  await Promise.all(paths.map(async (path) => {
    const asset = doc(db, path);
    const chunks = await getDocs(collection(asset, "chunks"));
    await Promise.all(chunks.docs.map((entry) => deleteDoc(entry.ref)));
    await deleteDoc(asset);
  }));
}
