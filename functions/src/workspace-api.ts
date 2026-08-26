/** Workspace lifecycle and membership. These are callables rather than client writes for two
 *  reasons: resolving an email to a uid needs the Admin SDK, and keeping every membership
 *  write server-side lets firestore.rules deny members/* outright — a client can then never
 *  grant itself access to anything, exactly like billing. */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { canManageMembers, canRemoveMember, normalizeEmail } from "./membership.js";
import { isValidWorkspaceId } from "./workspace-id.js";
import { addMemberDoc, createWorkspaceDocs, readWorkspace, removeMemberDoc } from "./workspace-store.js";

const OPTS = {
  region: "europe-west1" as const,
  enforceAppCheck: true,
  // Creating a brand or inviting a colleague is a rare, manual act; a low ceiling bounds
  // junk traffic at no real cost. See the maxInstances note in generate.ts.
  maxInstances: 3,
};

interface Caller { uid: string; email: string }

function requireCaller(request: { auth?: { uid: string; token?: { email?: string } } }): Caller {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  return { uid: request.auth.uid, email: normalizeEmail(request.auth.token?.email) };
}

function requireWorkspaceId(raw: unknown): string {
  if (!isValidWorkspaceId(raw)) {
    throw new HttpsError("invalid-argument", "workspaceId must be alphanumeric (with - or _).");
  }
  return raw;
}

/** Owner-only, resolved fresh on every call — never trusted from the client. */
async function requireOwnedWorkspace(wid: string, uid: string) {
  const workspace = await readWorkspace(getFirestore(), wid);
  if (!workspace) throw new HttpsError("not-found", "Workspace not found.");
  if (!canManageMembers(workspace, uid)) {
    throw new HttpsError("permission-denied", "Only the workspace owner can manage members.");
  }
  return workspace;
}

export const createWorkspace = onCall(OPTS, async (request) => {
  const caller = requireCaller(request);
  const { name, profile } = (request.data ?? {}) as { name?: unknown; profile?: unknown };
  if (typeof name !== "string" || name.trim() === "") {
    throw new HttpsError("invalid-argument", "name is required.");
  }
  const id = await createWorkspaceDocs(getFirestore(), {
    ownerUid: caller.uid,
    ownerEmail: caller.email,
    name: name.trim().slice(0, 120),
    // The brand profile is the client's own shape (lib/profile.ts normalizes it on read);
    // the server stores it verbatim, the same way the proxy never parses prompts.
    profile: profile ?? {},
  });
  return { id };
});

export const addMember = onCall(OPTS, async (request) => {
  const caller = requireCaller(request);
  const { workspaceId, email } = (request.data ?? {}) as { workspaceId?: unknown; email?: unknown };
  const wid = requireWorkspaceId(workspaceId);
  const target = normalizeEmail(email);
  if (target === "") throw new HttpsError("invalid-argument", "email is required.");
  await requireOwnedWorkspace(wid, caller.uid);

  // Membership is not the sign-in allowlist: a uid only exists once that person has signed in
  // at least once, which ALLOWED_EMAILS already had to permit. So "no such user" here means
  // "not allowlisted, or has never signed in" — both fixed outside this callable.
  let user;
  try {
    user = await getAuth().getUserByEmail(target);
  } catch {
    throw new HttpsError("not-found", "No account for that email yet — they must sign in once first.");
  }
  await addMemberDoc(getFirestore(), wid, { uid: user.uid, email: target }, caller.email);
  return { uid: user.uid, email: target };
});

export const removeMember = onCall(OPTS, async (request) => {
  const caller = requireCaller(request);
  const { workspaceId, uid } = (request.data ?? {}) as { workspaceId?: unknown; uid?: unknown };
  const wid = requireWorkspaceId(workspaceId);
  if (typeof uid !== "string" || uid.trim() === "") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  const workspace = await requireOwnedWorkspace(wid, caller.uid);
  if (!canRemoveMember(workspace, uid)) {
    throw new HttpsError("failed-precondition", "The owner cannot be removed from their own workspace.");
  }
  await removeMemberDoc(getFirestore(), wid, uid);
  return { ok: true as const };
});
