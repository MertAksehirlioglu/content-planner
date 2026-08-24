/** The allowlist is the only thing between a signed-in stranger and a paid API call. */

import assert from "node:assert/strict";
import test from "node:test";

import { isAllowed, parseAllowList } from "./allowlist.ts";

const LIST = "me@example.com, Someone.Else@Example.COM";

test("an allowed address passes, regardless of case or padding", () => {
  assert.ok(isAllowed("me@example.com", LIST));
  assert.ok(isAllowed("  ME@Example.com  ", LIST));
  assert.ok(isAllowed("someone.else@example.com", LIST));
});

test("an address not on the list is refused", () => {
  assert.ok(!isAllowed("stranger@example.com", LIST));
});

test("no substring, suffix, or domain matching", () => {
  // The dangerous near-misses: each of these shares text with an allowed entry.
  for (const impostor of [
    "evil-me@example.com",
    "me@example.com.attacker.net",
    "me@example.como",
    "attacker@example.com.evil.com",
    "example.com",
    "me",
  ]) {
    assert.ok(!isAllowed(impostor, LIST), impostor);
  }
});

test("plus-addressing is a different address", () => {
  assert.ok(!isAllowed("me+admin@example.com", LIST));
});

test("fails closed when the list is missing or empty", () => {
  for (const list of ["", "   ", ",,, ,", undefined, null as unknown as string]) {
    assert.ok(!isAllowed("me@example.com", list as string | undefined), JSON.stringify(list));
  }
});

test("a missing email is refused even against a good list", () => {
  for (const email of ["", "   ", undefined, null]) {
    assert.ok(!isAllowed(email, LIST), JSON.stringify(email));
  }
});

test("parseAllowList normalizes and drops blanks", () => {
  assert.deepEqual(parseAllowList(" A@b.com , ,C@d.com "), ["a@b.com", "c@d.com"]);
  assert.deepEqual(parseAllowList(undefined), []);
});
