"use client";

import { useEffect, useState } from "react";
import { useLocalStorage } from "@mantine/hooks";
import type { User } from "firebase/auth";

import { EMPTY_PROFILE, normalizeProfile } from "@/lib/profile";
import { createAccount, listAccounts, listItems, type Account, type Item } from "@/lib/store";

/**
 * Everything about "which brand am I working on and what is in its library".
 *
 * These four pieces of state are never useful apart: the account list decides which id is
 * active, the active id decides which items load, and every consumer wants the derived
 * `active`/`profile`/`backlog`/`published` rather than the raw arrays. Keeping them together
 * is what lets app/page.tsx treat accounts as a single value instead of a data-loading chore.
 *
 * Takes the URL context rather than reading it: the caller resolves `?company=` after
 * hydration, and loading accounts before that is known would briefly select the wrong one.
 */
export function useAccounts({ user, urlCompanyId, urlReady, onError }: {
  user: User | null | undefined;
  urlCompanyId: string;
  urlReady: boolean;
  onError: (message: string) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useLocalStorage<string>({
    key: "planner.activeAccount", defaultValue: "", getInitialValueInEffect: true,
  });
  const [items, setItems] = useState<Item[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null;
  const profile = active?.profile ?? EMPTY_PROFILE;
  const backlog = items.filter((i) => i.status === "backlog");
  const published = items.filter((i) => i.status === "published" || i.status === "skipped");

  // On sign-in, load the user's accounts. First time (none yet), seed a "Default"
  // account from any profile the previous localStorage-only version left behind.
  useEffect(() => {
    if (!user || !urlReady) return;
    let cancelled = false;
    (async () => {
      setLoadingAccounts(true);
      try {
        let list = await listAccounts(user.uid);
        if (list.length === 0) {
          const legacy = normalizeProfile(
            typeof window !== "undefined" ? localStorage.getItem("planner.profile") : null,
          );
          const created = await createAccount(user.uid, "Default", legacy);
          list = [created];
        }
        if (cancelled) return;
        setAccounts(list);
        setActiveId((cur) => list.some((a) => a.id === urlCompanyId)
          ? urlCompanyId : list.some((a) => a.id === cur) ? cur : list[0].id);
      } catch (err) {
        if (!cancelled) onError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, urlCompanyId, urlReady, setActiveId]);

  // Load the active account's items (kept posts + backlog) whenever it changes.
  useEffect(() => {
    if (!user || !active) return;
    let cancelled = false;
    listItems(user.uid, active.id)
      .then((list) => { if (!cancelled) setItems(list); })
      .catch((err) => { if (!cancelled) onError((err as Error).message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, active?.id]);

  return {
    accounts, setAccounts,
    activeId, setActiveId,
    items, setItems,
    loadingAccounts,
    active, profile, backlog, published,
  };
}
