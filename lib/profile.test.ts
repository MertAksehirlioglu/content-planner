/** Reading a stored profile must never throw — a bad one blanks the whole page. */

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CATEGORIES, EMPTY_PROFILE, normalizeProfile } from "./profile.ts";

test("a profile written by the pre-Next UI still loads", () => {
  // v1 used snake_case `all_categories`; reading `allCategories` off it threw on .map().
  const v1 = {
    business: "visionOS apps for yacht brokerages",
    audience: "brokerage owners",
    tone: "confident",
    frequency: 4,
    all_categories: ["Behind the scenes", "Drone footage"],
    categories: ["Drone footage"],
  };
  const p = normalizeProfile(JSON.stringify(v1));
  assert.equal(p.business, "visionOS apps for yacht brokerages");
  assert.equal(p.frequency, 4);
  assert.deepEqual(p.allCategories, ["Behind the scenes", "Drone footage"]); // custom one kept
  assert.deepEqual(p.categories, ["Drone footage"]);
});

test("unreadable storage falls back instead of throwing", () => {
  for (const raw of ["{not json", "", "null", "[]", '"a string"', undefined, null]) {
    assert.deepEqual(normalizeProfile(raw), EMPTY_PROFILE, JSON.stringify(raw));
  }
});

test("wrong types per field fall back per field", () => {
  const p = normalizeProfile(
    JSON.stringify({
      business: 42,
      tone: null,
      frequency: "many",
      allCategories: [1, 2],
      categories: "nope",
    }),
  );
  assert.equal(p.business, "");
  assert.equal(p.tone, "");
  assert.equal(p.frequency, 3);
  assert.deepEqual(p.allCategories, DEFAULT_CATEGORIES);
  assert.deepEqual(p.categories, EMPTY_PROFILE.categories);
});

test("out-of-range frequency falls back to 3", () => {
  for (const frequency of [0, 8, -1, 2.5, Number.NaN]) {
    assert.equal(normalizeProfile(JSON.stringify({ frequency })).frequency, 3, String(frequency));
  }
  assert.equal(normalizeProfile(JSON.stringify({ frequency: 7 })).frequency, 7);
});

test("a current profile round-trips unchanged", () => {
  const current = {
    business: "a cafe",
    audience: "locals",
    tone: "warm",
    language: "English",
    products: "coffee and pastries",
    founderVoice: "personal and practical",
    visualIdentity: "warm neutrals",
    approvedFacts: "Open since 2020",
    avoid: "hype",
    platforms: ["instagram", "linkedin"] as ("instagram" | "linkedin")[],
    publishers: ["company", "founder"] as ("company" | "founder")[],
    frequency: 5,
    allCategories: ["Behind the scenes"],
    categories: [],
    styleRules: ["Never open with a question."],
  };
  assert.deepEqual(normalizeProfile(JSON.stringify(current)), current);
});
