import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidWorkspaceId } from "./workspace-id.ts";

test("accepts Firestore-shaped ids", () => {
  assert.equal(isValidWorkspaceId("aBc123"), true);
  assert.equal(isValidWorkspaceId("my-workspace_2"), true);
});

test("rejects path separators that would reshape the usage doc path", () => {
  // The whole point: `workspaces/x/items/y/usage` matches a member-writable rule.
  assert.equal(isValidWorkspaceId("x/items/y"), false);
  assert.equal(isValidWorkspaceId("../billing"), false);
  assert.equal(isValidWorkspaceId("a.b"), false);
});

test("rejects non-strings, empty, and over-long ids", () => {
  assert.equal(isValidWorkspaceId(undefined), false);
  assert.equal(isValidWorkspaceId(42), false);
  assert.equal(isValidWorkspaceId(""), false);
  assert.equal(isValidWorkspaceId("a".repeat(65)), false);
});
