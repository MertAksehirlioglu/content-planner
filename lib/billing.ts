/** Client reads of the server-written budget + spend docs, and typed wrappers over the
 *  admin callables. The client can read these docs but never write them (firestore.rules). */
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

export interface Budget { monthlyUsd: number }
export interface Spend { totalUsd: number; byAccount: Record<string, number> }
export interface AdminUserRow {
  uid: string; email: string; monthlyUsd: number; spentUsd: number; remainingUsd: number;
}

/** UTC YYYY-MM — must match the server's monthKey so we read the right spend doc. */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function loadBudget(uid: string): Promise<Budget | null> {
  const snap = await getDoc(doc(db, "users", uid, "billing", "budget"));
  return snap.exists() ? { monthlyUsd: (snap.data().monthlyUsd as number) ?? 0 } : null;
}

export async function loadSpend(uid: string, month: string): Promise<Spend> {
  const snap = await getDoc(doc(db, "users", uid, "billing", `spend_${month}`));
  const data = snap.data();
  return {
    totalUsd: (data?.totalUsd as number) ?? 0,
    byAccount: (data?.byAccount as Record<string, number>) ?? {},
  };
}

export async function callSetBudget(uid: string, monthlyUsd: number): Promise<void> {
  await httpsCallable(functions, "setBudget")({ uid, monthlyUsd });
}

/** Returns null when the caller isn't an admin (the callable rejects with permission-denied),
 *  so the UI can hide the admin panel without the client ever knowing the admin list. */
export async function callListUsers(): Promise<AdminUserRow[] | null> {
  try {
    const res = await httpsCallable<unknown, { users: AdminUserRow[] }>(functions, "listUsers")({});
    return res.data.users;
  } catch (err) {
    if ((err as { code?: string }).code === "functions/permission-denied") return null;
    throw err;
  }
}
