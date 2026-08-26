/** Firestore CRUD for shared workspaces — the brand profile, its items (backlog +
 *  production workflow), its weeks and its usage log. Kept out of lib/plan.ts so the prompt
 *  logic stays offline-testable. lib/media.ts and lib/billing.ts are the only other modules
 *  that touch Firestore: media because image chunks live under weeks/, billing because spend
 *  stayed on the per-user path.
 *
 *  A workspace is shared: every member reads and writes the same brand. Budgets are not —
 *  those stay at users/{uid}/billing/* and are metered per signed-in user. */

import {
  addDoc, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc,
  updateDoc, where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/lib/firebase";
import { normalizeProfile, type Profile } from "@/lib/profile";
import type { Post } from "@/lib/plan";
import { postFingerprint } from "@/lib/history";
import type { UsageSnapshot } from "@/lib/cost";
import type { WeekWorkspace } from "@/lib/week";

export type ItemStatus = "backlog" | "planned" | "in_production" | "ready" | "published" | "skipped";

export interface Workspace {
  id: string;
  name: string;
  profile: Profile;
  platform: "instagram" | "multi";
  ownerUid: string;
  createdAt: number;
}

export interface Member {
  uid: string;
  email: string;
  addedAt: number;
  addedBy: string;
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

const workspaceRef = (workspaceId: string) => doc(db, "workspaces", workspaceId);
const itemsCol = (workspaceId: string) => collection(db, "workspaces", workspaceId, "items");
const usageCol = (workspaceId: string) => collection(db, "workspaces", workspaceId, "usage");
const membersCol = (workspaceId: string) => collection(db, "workspaces", workspaceId, "members");

/**
 * Every workspace this user belongs to.
 *
 * Membership lives in one place — workspaces/{id}/members/{uid} — so "which workspaces am I
 * in" is a collection-group query rather than a mirrored index under the user that could
 * drift. It filters on the `uid` *field* because that is what firestore.rules can prove a
 * query against; the doc id alone would not do. Needs the collection-group index in
 * firestore.indexes.json.
 */
export async function listWorkspaces(uid: string): Promise<Workspace[]> {
  const memberships = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", uid)));
  const ids = memberships.docs
    .map((entry) => entry.ref.parent.parent)
    .filter((parent) => parent?.parent.id === "workspaces")
    .map((parent) => parent!.id);
  const snaps = await Promise.all(ids.map((id) => getDoc(workspaceRef(id))));
  return snaps
    .filter((snap) => snap.exists())
    .map((snap) => {
      const data = snap.data() as Omit<Workspace, "id">;
      return {
        id: snap.id, ...data,
        profile: normalizeProfile(JSON.stringify(data.profile)),
        platform: "multi" as const,
      };
    })
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/** Creating a workspace is a callable: the workspace doc and the owner's member doc must land
 *  together, and firestore.rules denies client creates so that guarantee cannot be bypassed. */
export async function createWorkspace(name: string, profile: Profile): Promise<string> {
  const res = await httpsCallable<
    { name: string; profile: Profile }, { id: string }
  >(functions, "createWorkspace")({ name, profile });
  return res.data.id;
}

export function updateWorkspaceProfile(workspaceId: string, profile: Profile): Promise<void> {
  return updateDoc(workspaceRef(workspaceId), { profile });
}

export function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  return updateDoc(workspaceRef(workspaceId), { name });
}

/** ponytail: deletes the workspace doc only; items/weeks/members are orphaned. Owner-only
 *  (firestore.rules checks ownerUid), which is the part that matters now that brands are
 *  shared. Upgrade path: a recursive delete callable if orphaned subcollections ever cost
 *  more than the storage they sit in. */
export function deleteWorkspace(workspaceId: string): Promise<void> {
  return deleteDoc(workspaceRef(workspaceId));
}

export async function listMembers(workspaceId: string): Promise<Member[]> {
  const snap = await getDocs(membersCol(workspaceId));
  return snap.docs.map((entry) => ({ uid: entry.id, ...entry.data() } as Member))
    .sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
}

/** Both membership writes are callables: resolving an email to a uid needs the Admin SDK, and
 *  firestore.rules denies every client write to members/*. */
export async function addMemberByEmail(workspaceId: string, email: string): Promise<Member> {
  const res = await httpsCallable<
    { workspaceId: string; email: string }, { uid: string; email: string }
  >(functions, "addMember")({ workspaceId, email });
  return { ...res.data, addedAt: Date.now(), addedBy: "" };
}

export async function removeMember(workspaceId: string, uid: string): Promise<void> {
  await httpsCallable<{ workspaceId: string; uid: string }, { ok: true }>(
    functions, "removeMember",
  )({ workspaceId, uid });
}

export async function listItems(workspaceId: string): Promise<Item[]> {
  const snap = await getDocs(query(itemsCol(workspaceId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => {
    const data = d.data() as Omit<Item, "id">;
    const legacyStatus = (d.data() as { status?: string }).status;
    return { id: d.id, ...data, status: legacyStatus === "used" ? "published" : data.status };
  });
}

export async function addItem(workspaceId: string, input: NewItem): Promise<Item> {
  // Firestore rejects `undefined`, so only include `post` when present.
  const body = {
    status: input.status,
    summary: input.summary,
    createdAt: Date.now(),
    ...(input.post ? { post: input.post } : {}),
  };
  const ref = await addDoc(itemsCol(workspaceId), body);
  return { id: ref.id, ...body };
}

export function setItemStatus(
  workspaceId: string, itemId: string, status: ItemStatus,
): Promise<void> {
  return updateDoc(doc(db, "workspaces", workspaceId, "items", itemId), { status });
}

export function deleteItem(workspaceId: string, itemId: string): Promise<void> {
  return deleteDoc(doc(db, "workspaces", workspaceId, "items", itemId));
}

// usage events are written server-side by the generate proxy (Admin SDK); the client is
// read-only here (firestore.rules denies client writes to usage/*).
export async function listUsage(workspaceId: string): Promise<UsageEvent[]> {
  const snap = await getDocs(query(usageCol(workspaceId), orderBy("createdAt", "desc")));
  return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as UsageEvent));
}

const weekDoc = (workspaceId: string, weekKey: string) =>
  doc(db, "workspaces", workspaceId, "weeks", weekKey);
const weeksCol = (workspaceId: string) => collection(db, "workspaces", workspaceId, "weeks");

export async function loadWeek(workspaceId: string, weekKey: string): Promise<WeekWorkspace | null> {
  const snap = await getDoc(weekDoc(workspaceId, weekKey));
  return snap.exists() ? snap.data() as WeekWorkspace : null;
}

export function saveWeek(workspaceId: string, workspace: WeekWorkspace): Promise<void> {
  // Image bytes live in chunk documents; never copy hydrated data URLs into this document.
  const imageStates = Object.fromEntries(Object.entries(workspace.imageStates).map(([postId, state]) => [postId, {
    ...state, images: state.images.map((image) => ({ ...image, url: "" })),
  }]));
  return setDoc(weekDoc(workspaceId, workspace.weekKey), { ...workspace, imageStates, updatedAt: Date.now() });
}

export function deleteWeek(workspaceId: string, weekKey: string): Promise<void> {
  return deleteDoc(weekDoc(workspaceId, weekKey));
}

export async function listRecentWeekPosts(
  workspaceId: string, excludeWeekKey: string, weekLimit = 12,
): Promise<string[]> {
  const snap = await getDocs(weeksCol(workspaceId));
  return snap.docs
    .filter((entry) => entry.id !== excludeWeekKey)
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, weekLimit)
    .flatMap((entry) => ((entry.data() as WeekWorkspace).plan?.posts ?? []).map(postSummary));
}
