import type { Plan, Strategy } from "@/lib/plan";
import type { UsageSnapshot } from "@/lib/cost";

export interface SavedImage {
  url: string;
  path: string;
  mimeType: string;
  model: string;
  usage: UsageSnapshot;
}
export interface SavedImageState {
  stage: "idle" | "proposed" | "generated" | "accepted";
  prompts: string[];
  retryCount: number;
  images: SavedImage[];
  reuseFirstVisual?: boolean;
}
export interface WeekWorkspace {
  weekKey: string;
  weeklyGoals: string;
  thisWeek: string;
  availableAssets: string;
  requirements: string;
  feedback: string;
  strategy: Strategy | null;
  plan: Plan | null;
  imageStates: Record<string, SavedImageState>;
  updatedAt: number;
}

export function currentWeekKey(date = new Date()): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function shiftWeekKey(weekKey: string, offset: number): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return currentWeekKey();
  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() || 7) - 1) + (week - 1 + offset) * 7);
  return currentWeekKey(monday);
}

export function emptyWeek(weekKey = currentWeekKey()): WeekWorkspace {
  return { weekKey, weeklyGoals: "", thisWeek: "", availableAssets: "", requirements: "",
    feedback: "", strategy: null, plan: null, imageStates: {}, updatedAt: Date.now() };
}

/**
 * Names the exact (user, account, week) a piece of loaded state belongs to.
 *
 * Every async write in the planner races the user: loads, a 700ms debounced autosave, and
 * generations all finish *after* the click that started them, by which time the user may have
 * switched workspace or week. Comparing this string before applying a result is what stops a
 * stale write landing on the wrong week. It was built by hand in five places; one function
 * means one format.
 */
export function workspaceIdentity(workspaceId: string, weekKey: string): string {
  return `${workspaceId}:${weekKey}`;
}

/**
 * Whether the debounced autosave may fire.
 *
 * Both guards matter. `weekReady` false means the load hasn't populated state yet — saving then
 * would persist empty fields over real saved work. A loaded identity that differs from the
 * current one means the user moved on mid-load, so this state belongs to a week they left.
 */
export function shouldAutosaveWeek(
  loadedIdentity: string, currentIdentity: string, weekReady: boolean,
): boolean {
  return weekReady && loadedIdentity !== "" && loadedIdentity === currentIdentity;
}

/**
 * Whether the saved image manifest disagrees with what recovery actually found, meaning the
 * manifest should be rewritten once so later loads can use the direct path. Compares the set of
 * stored paths, order-insensitively — a reordering is not a difference.
 */
export function imageManifestDiffers(
  saved: Record<string, SavedImageState> | undefined,
  recovered: Record<string, SavedImageState>,
): boolean {
  const paths = (states: Record<string, SavedImageState> | undefined) =>
    Object.values(states ?? {}).flatMap((s) => s.images.map((i) => i.path)).sort();
  const a = paths(saved);
  const b = paths(recovered);
  return a.length !== b.length || a.some((path, i) => path !== b[i]);
}
