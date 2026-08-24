/** The only Firestore-touching module. Account state (business profiles + their
 *  saved/backlog items) scoped to the signed-in user's uid. Kept out of lib/plan.ts
 *  so the prompt logic stays offline-testable. */

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { normalizeProfile, type Profile } from "@/lib/profile";
import type { Post } from "@/lib/plan";
import { postFingerprint } from "@/lib/history";
import type { UsageSnapshot } from "@/lib/cost";
import type { WeekWorkspace } from "@/lib/week";

export type ItemStatus = "backlog" | "planned" | "in_production" | "ready" | "published" | "skipped";

export interface Account {
  id: string;
  name: string;
  profile: Profile;
  platform: "instagram" | "multi";
  createdAt: number;
}

export interface Item {
  id: string;
  status: ItemStatus;
  summary: string;
  post?: Post;
  createdAt: number;
}

export interface NewItem {
  status: ItemStatus;
  summary: string;
  post?: Post;
}

export interface UsageEvent {
  id: string;
  operation: "strategy" | "content" | "content_plan" | "transform" | "image" | "image_retry" | "image_final";
  model: string;
  usage: UsageSnapshot;
  imageCount: number;
  estimatedUsd: number;
  rateNote: string;
  createdAt: number;
}

/** Compact semantic fingerprint for lists and future deduplication prompts. */
export function postSummary(post: Post): string {
  return postFingerprint(post);
}

const accountsCol = (uid: string) => collection(db, "users", uid, "accounts");
const itemsCol = (uid: string, accountId: string) =>
  collection(db, "users", uid, "accounts", accountId, "items");
const usageCol = (uid: string, accountId: string) =>
  collection(db, "users", uid, "accounts", accountId, "usage");

export async function listAccounts(uid: string): Promise<Account[]> {
  const snap = await getDocs(query(accountsCol(uid), orderBy("createdAt", "asc")));
  return snap.docs.map((d) => {
    const data = d.data() as Omit<Account, "id">;
    return { id: d.id, ...data, profile: normalizeProfile(JSON.stringify(data.profile)), platform: "multi" };
  });
}

export async function createAccount(
  uid: string, name: string, profile: Profile,
): Promise<Account> {
  const body: Omit<Account, "id"> = {
    name, profile, platform: "multi", createdAt: Date.now(),
  };
  const ref = await addDoc(accountsCol(uid), body);
  return { id: ref.id, ...body };
}

export function updateAccountProfile(
  uid: string, accountId: string, profile: Profile,
): Promise<void> {
  return updateDoc(doc(db, "users", uid, "accounts", accountId), { profile });
}

export function renameAccount(uid: string, accountId: string, name: string): Promise<void> {
  return updateDoc(doc(db, "users", uid, "accounts", accountId), { name });
}

/** ponytail: deletes the account doc only; its items subcollection is orphaned.
 *  Fine for a single-owner POC. Upgrade path: a recursive delete (Cloud Function or
 *  the admin SDK from the future CLI) if orphaned items ever matter. */
export function deleteAccount(uid: string, accountId: string): Promise<void> {
  return deleteDoc(doc(db, "users", uid, "accounts", accountId));
}

export async function listItems(uid: string, accountId: string): Promise<Item[]> {
  const snap = await getDocs(query(itemsCol(uid, accountId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => {
    const data = d.data() as Omit<Item, "id">;
    const legacyStatus = (d.data() as { status?: string }).status;
    return { id: d.id, ...data, status: legacyStatus === "used" ? "published" : data.status };
  });
}

export async function addItem(
  uid: string, accountId: string, input: NewItem,
): Promise<Item> {
  // Firestore rejects `undefined`, so only include `post` when present.
  const body = {
    status: input.status,
    summary: input.summary,
    createdAt: Date.now(),
    ...(input.post ? { post: input.post } : {}),
  };
  const ref = await addDoc(itemsCol(uid, accountId), body);
  return { id: ref.id, ...body };
}

export function setItemStatus(
  uid: string, accountId: string, itemId: string, status: ItemStatus,
): Promise<void> {
  return updateDoc(doc(db, "users", uid, "accounts", accountId, "items", itemId), { status });
}

export function deleteItem(
  uid: string, accountId: string, itemId: string,
): Promise<void> {
  return deleteDoc(doc(db, "users", uid, "accounts", accountId, "items", itemId));
}

// usage events are now written server-side by the generate proxy (Admin SDK); the client is
// read-only here (firestore.rules denies client writes to usage/*).
export async function listUsage(uid: string, accountId: string): Promise<UsageEvent[]> {
  const snap = await getDocs(query(usageCol(uid, accountId), orderBy("createdAt", "desc")));
  return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as UsageEvent));
}

const weekDoc = (uid: string, accountId: string, weekKey: string) =>
  doc(db, "users", uid, "accounts", accountId, "weeks", weekKey);
const weeksCol = (uid: string, accountId: string) =>
  collection(db, "users", uid, "accounts", accountId, "weeks");

export async function loadWeek(uid: string, accountId: string, weekKey: string): Promise<WeekWorkspace | null> {
  const snap = await getDoc(weekDoc(uid, accountId, weekKey));
  return snap.exists() ? snap.data() as WeekWorkspace : null;
}

export function saveWeek(uid: string, accountId: string, workspace: WeekWorkspace): Promise<void> {
  // Image bytes live in chunk documents; never copy hydrated data URLs into this document.
  const imageStates = Object.fromEntries(Object.entries(workspace.imageStates).map(([postId, state]) => [postId, {
    ...state, images: state.images.map((image) => ({ ...image, url: "" })),
  }]));
  return setDoc(weekDoc(uid, accountId, workspace.weekKey), { ...workspace, imageStates, updatedAt: Date.now() });
}

export function deleteWeek(uid: string, accountId: string, weekKey: string): Promise<void> {
  return deleteDoc(weekDoc(uid, accountId, weekKey));
}

export async function listRecentWeekPosts(
  uid: string, accountId: string, excludeWeekKey: string, weekLimit = 12,
): Promise<string[]> {
  const snap = await getDocs(weeksCol(uid, accountId));
  return snap.docs
    .filter((entry) => entry.id !== excludeWeekKey)
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, weekLimit)
    .flatMap((entry) => ((entry.data() as WeekWorkspace).plan?.posts ?? []).map(postSummary));
}
