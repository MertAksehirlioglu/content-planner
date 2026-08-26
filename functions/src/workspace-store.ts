/** Admin-SDK reads/writes for shared workspaces. Not unit-tested (imports the SDK); the
 *  decisions live in the pure membership.ts, this file only fetches and commits. */
import { HttpsError } from "firebase-functions/v2/https";
import { type Firestore } from "firebase-admin/firestore";

import { isMember, type MemberDoc, type WorkspaceDoc } from "./membership.js";
import { isValidWorkspaceId } from "./workspace-id.js";

const workspaceRef = (db: Firestore, wid: string) => db.doc(`workspaces/${wid}`);
const memberRef = (db: Firestore, wid: string, uid: string) =>
  db.doc(`workspaces/${wid}/members/${uid}`);

export async function readWorkspace(db: Firestore, wid: string): Promise<WorkspaceDoc | undefined> {
  return (await workspaceRef(db, wid).get()).data() as WorkspaceDoc | undefined;
}

/**
 * The server-side half of access control. firestore.rules protect the browser's path to a
 * workspace; they do nothing about the Admin SDK path the generate proxy uses, which would
 * otherwise let any signed-in user write usage events into a stranger's workspace — an
 * integrity and activity-disclosure problem, not a money one (spend stays keyed by uid).
 *
 * Costs two document reads. Call it before spending anything, so a rejected caller never
 * leaves a budget hold behind.
 */
export async function assertMember(db: Firestore, wid: string, uid: string): Promise<void> {
  if (!isValidWorkspaceId(wid)) {
    throw new HttpsError("invalid-argument", "workspaceId must be alphanumeric (with - or _).");
  }
  const [workspaceSnap, memberSnap] = await db.getAll(workspaceRef(db, wid), memberRef(db, wid, uid));
  if (!isMember({
    uid,
    workspace: workspaceSnap.data() as WorkspaceDoc | undefined,
    memberExists: memberSnap.exists,
  })) {
    throw new HttpsError("permission-denied", "You are not a member of this workspace.");
  }
}

/** Workspace doc + the owner's member doc in one batch. Two ungoverned client writes would
 *  leave a workspace nobody can reach if the second one failed, which is why firestore.rules
 *  denies client creates outright. */
export async function createWorkspaceDocs(
  db: Firestore, args: { ownerUid: string; ownerEmail: string; name: string; profile: unknown },
): Promise<string> {
  const ref = db.collection("workspaces").doc();
  const batch = db.batch();
  batch.set(ref, {
    name: args.name,
    profile: args.profile,
    ownerUid: args.ownerUid,
    platform: "multi",
    createdAt: Date.now(),
  });
  batch.set(memberRef(db, ref.id, args.ownerUid), member(args.ownerUid, args.ownerEmail, args.ownerEmail));
  await batch.commit();
  return ref.id;
}

export async function addMemberDoc(
  db: Firestore, wid: string, target: { uid: string; email: string }, addedBy: string,
): Promise<void> {
  await memberRef(db, wid, target.uid).set(member(target.uid, target.email, addedBy));
}

export async function removeMemberDoc(db: Firestore, wid: string, uid: string): Promise<void> {
  await memberRef(db, wid, uid).delete();
}

function member(uid: string, email: string, addedBy: string): MemberDoc {
  return { uid, email, addedAt: Date.now(), addedBy };
}
