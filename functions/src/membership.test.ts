import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageMembers, canRemoveMember, isMember, normalizeEmail } from "./membership.ts";

const ws = { ownerUid: "owner" };

test("a member document grants access", () => {
  assert.equal(isMember({ uid: "mate", workspace: ws, memberExists: true }), true);
});

test("a signed-in non-member is refused", () => {
  assert.equal(isMember({ uid: "stranger", workspace: ws, memberExists: false }), false);
});

test("fails closed on an unknown workspace or a blank uid", () => {
  assert.equal(isMember({ uid: "owner", workspace: undefined, memberExists: true }), false);
  assert.equal(isMember({ uid: "", workspace: ws, memberExists: true }), false);
  assert.equal(isMember({ uid: undefined, workspace: ws, memberExists: true }), false);
});

test("the owner is never locked out of their own workspace", () => {
  // createWorkspace writes the owner's member doc in the same batch, so this only bites if
  // something deleted it — and there is no UI path back from that.
  assert.equal(isMember({ uid: "owner", workspace: ws, memberExists: false }), true);
});

test("only the owner manages members", () => {
  assert.equal(canManageMembers(ws, "owner"), true);
  assert.equal(canManageMembers(ws, "mate"), false);
  assert.equal(canManageMembers(undefined, "owner"), false);
  assert.equal(canManageMembers({}, undefined), false);
});

test("the owner cannot be removed", () => {
  assert.equal(canRemoveMember(ws, "mate"), true);
  assert.equal(canRemoveMember(ws, "owner"), false);
});

test("emails compare case- and whitespace-insensitively", () => {
  assert.equal(normalizeEmail("  Me@Example.COM "), "me@example.com");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail(42), "");
});
