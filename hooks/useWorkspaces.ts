"use client";

import { useEffect, useState } from "react";
import { useLocalStorage } from "@mantine/hooks";
import type { User } from "firebase/auth";

import { EMPTY_PROFILE, normalizeProfile } from "@/lib/profile";
import { createWorkspace, listItems, listWorkspaces, type Item, type Workspace } from "@/lib/store";

/**
 * Everything about "which brand am I working on and what is in its library".
 *
 * These four pieces of state are never useful apart: the workspace list decides which id is
 * active, the active id decides which items load, and every consumer wants the derived
 * `active`/`profile`/`backlog`/`published` rather than the raw arrays. Keeping them together
 * is what lets app/page.tsx treat workspaces as a single value instead of a data-loading chore.
 *
 * A workspace is shared with its members, so `user` decides which workspaces are *visible*,
 * never which data they contain. The user's budget is a separate, per-user concern.
 *
 * Takes the URL context rather than reading it: the caller resolves `?company=` after
 * hydration, and loading workspaces before that is known would briefly select the wrong one.
 */
export function useWorkspaces({ user, urlCompanyId, urlReady, onError }: {
  user: User | null | undefined;
  urlCompanyId: string;
  urlReady: boolean;
  onError: (message: string) => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  // Key kept from the pre-workspace version: workspace ids *are* the old account ids, so an
  // existing selection survives the migration instead of resetting to the first brand.
  const [activeId, setActiveId] = useLocalStorage<string>({
    key: "planner.activeAccount", defaultValue: "", getInitialValueInEffect: true,
  });
  const [items, setItems] = useState<Item[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);

  const active = workspaces.find((a) => a.id === activeId) ?? workspaces[0] ?? null;
  const profile = active?.profile ?? EMPTY_PROFILE;
  const backlog = items.filter((i) => i.status === "backlog");
  const published = items.filter((i) => i.status === "published" || i.status === "skipped");

  // On sign-in, load the workspaces this user is a member of. First time (none yet), seed a
  // "Default" workspace from any profile the previous localStorage-only version left behind.
  useEffect(() => {
    if (!user || !urlReady) return;
    let cancelled = false;
    (async () => {
      setLoadingWorkspaces(true);
      try {
        let list = await listWorkspaces(user.uid);
        if (list.length === 0) {
          const legacy = normalizeProfile(
            typeof window !== "undefined" ? localStorage.getItem("planner.profile") : null,
          );
          await createWorkspace("Default", legacy);
          list = await listWorkspaces(user.uid);
        }
        if (cancelled) return;
        setWorkspaces(list);
        setActiveId((cur) => list.some((a) => a.id === urlCompanyId)
          ? urlCompanyId : list.some((a) => a.id === cur) ? cur : list[0].id);
      } catch (err) {
        if (!cancelled) onError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingWorkspaces(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, urlCompanyId, urlReady, setActiveId]);

  // Load the active workspace's items (kept posts + backlog) whenever it changes.
  useEffect(() => {
    if (!user || !active) return;
    let cancelled = false;
    listItems(active.id)
      .then((list) => { if (!cancelled) setItems(list); })
      .catch((err) => { if (!cancelled) onError((err as Error).message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, active?.id]);

  return {
    workspaces, setWorkspaces,
    activeId, setActiveId,
    items, setItems,
    loadingWorkspaces,
    active, profile, backlog, published,
  };
}
