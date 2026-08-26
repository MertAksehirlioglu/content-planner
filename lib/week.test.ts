import assert from "node:assert/strict";
import test from "node:test";
import { currentWeekKey, emptyWeek, imageManifestDiffers, shiftWeekKey, shouldAutosaveWeek,
  workspaceIdentity, type SavedImageState } from "./week.ts";

test("week keys follow ISO week years", () => {
  assert.equal(currentWeekKey(new Date("2026-08-12T12:00:00Z")), "2026-W33");
  assert.equal(currentWeekKey(new Date("2027-01-01T12:00:00Z")), "2026-W53");
});

test("week navigation crosses ISO year boundaries", () => {
  assert.equal(shiftWeekKey("2026-W53", 1), "2027-W01");
  assert.equal(shiftWeekKey("2027-W01", -1), "2026-W53");
});

test("a new weekly workspace starts empty", () => {
  const workspace = emptyWeek("2026-W33");
  assert.equal(workspace.weekKey, "2026-W33");
  assert.equal(workspace.plan, null);
  assert.deepEqual(workspace.imageStates, {});
});

test("workspaceIdentity is stable and distinguishes every axis", () => {
  assert.equal(workspaceIdentity("a1", "2026-W33"), "a1:2026-W33");
  assert.notEqual(workspaceIdentity("a1", "2026-W33"), workspaceIdentity("a2", "2026-W33"));
  assert.notEqual(workspaceIdentity("a1", "2026-W33"), workspaceIdentity("a1", "2026-W34"));
});

test("autosave only fires for the week that is actually loaded", () => {
  const here = workspaceIdentity("a1", "2026-W33");
  const elsewhere = workspaceIdentity("a2", "2026-W33");

  assert.equal(shouldAutosaveWeek(here, here, true), true);
  // Switched account mid-load: this state belongs to a week the user left.
  assert.equal(shouldAutosaveWeek(here, elsewhere, true), false);
  // Load has not populated state yet — saving now would blank real saved work.
  assert.equal(shouldAutosaveWeek(here, here, false), false);
  // Nothing loaded at all (the load effect clears the ref before starting).
  assert.equal(shouldAutosaveWeek("", "", true), false);
});

test("manifest repair triggers only on a real difference in stored paths", () => {
  const state = (paths: string[]): SavedImageState => ({
    stage: "generated", prompts: [], retryCount: 0,
    images: paths.map((path) => ({ url: "", path, mimeType: "image/png", model: "m",
      usage: { promptTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0,
        outputImageTokens: 0, cachedTokens: 0 } })),
  });

  assert.equal(imageManifestDiffers({ p1: state(["a", "b"]) }, { p1: state(["a", "b"]) }), false);
  // Order is not a difference — both sides are sorted before comparing.
  assert.equal(imageManifestDiffers({ p1: state(["b", "a"]) }, { p1: state(["a", "b"]) }), false);
  assert.equal(imageManifestDiffers({ p1: state(["a"]) }, { p1: state(["a", "b"]) }), true);
  assert.equal(imageManifestDiffers({ p1: state(["a"]) }, { p1: state(["c"]) }), true);
  // An absent manifest with recovered images must repair.
  assert.equal(imageManifestDiffers(undefined, { p1: state(["a"]) }), true);
  assert.equal(imageManifestDiffers(undefined, {}), false);
});
