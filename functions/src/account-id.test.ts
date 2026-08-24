import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidAccountId } from "./account-id.ts";

test("accepts Firestore-shaped ids", () => {
  assert.equal(isValidAccountId("aBc123"), true);
  assert.equal(isValidAccountId("my-account_2"), true);
});

test("rejects path separators that would reshape the usage doc path", () => {
  // The whole point: `users/{uid}/accounts/x/items/y/usage` matches an owner-writable rule.
  assert.equal(isValidAccountId("x/items/y"), false);
  assert.equal(isValidAccountId("../billing"), false);
  assert.equal(isValidAccountId("a.b"), false);
});

test("rejects non-strings, empty, and over-long ids", () => {
  assert.equal(isValidAccountId(undefined), false);
  assert.equal(isValidAccountId(42), false);
  assert.equal(isValidAccountId(""), false);
  assert.equal(isValidAccountId("a".repeat(65)), false);
});
