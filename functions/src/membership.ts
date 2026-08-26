/** Pure membership decisions for shared workspaces. No SDK, so node --test runs it; the
 *  Firestore lookups live in workspace-store.ts.
 *
 *  Membership is deliberately its own concern, separate from ALLOWED_EMAILS: the allowlist
 *  decides who may hold a session at all, membership decides which brands that session sees. */

export interface WorkspaceDoc { ownerUid?: string }

/** A workspace member document. `uid` is duplicated into the body (it is also the doc id)
 *  because collectionGroup("members").where("uid","==",…) — how the browser lists the
 *  workspaces it belongs to — can only filter on a field. */
export interface MemberDoc { uid: string; email: string; addedAt: number; addedBy: string }

/**
 * Is `uid` allowed to touch this workspace?
 *
 * Fails closed: an unknown workspace, or a blank uid, is never a member. The owner passes
 * even without a member document — createWorkspace writes both in one batch, so that can
 * only happen if something deleted the doc, and locking the owner out of their own brand
 * would be unrecoverable from the UI. ownerUid is safe to trust: firestore.rules forbids
 * both creating a workspace and changing ownerUid on one, so only the Admin SDK ever sets it.
 */
export function isMember(args: {
  uid: string | undefined;
  workspace: WorkspaceDoc | undefined;
  memberExists: boolean;
}): boolean {
  const { uid, workspace, memberExists } = args;
  if (typeof uid !== "string" || uid.trim() === "") return false;
  if (!workspace) return false;
  if (workspace.ownerUid === uid) return true;
  return memberExists === true;
}

/** Adding and removing members is the owner's alone — a member cannot widen the circle. */
export function canManageMembers(workspace: WorkspaceDoc | undefined, uid: string | undefined): boolean {
  return typeof uid === "string" && uid !== "" && workspace?.ownerUid === uid;
}

/** The owner is the workspace; removing them would leave it unmanageable. */
export function canRemoveMember(workspace: WorkspaceDoc | undefined, targetUid: string): boolean {
  return workspace?.ownerUid !== targetUid;
}

/** Matches the allowlist's comparison so "the same address" means the same thing in both. */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}
