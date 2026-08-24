import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RULES, buildRulePrompt, mergeStyleRules, parseStyleRule } from "./rules.ts";
import type { Plan } from "./plan.ts";

const plan = { week_theme: "t", posts: [] } as unknown as Plan;

test("the rule prompt carries feedback, both plans, and the existing rules", () => {
  const prompt = buildRulePrompt(plan, plan, "  stop using exclamation marks  ", ["Keep captions under 90 words."]);
  assert.match(prompt, /stop using exclamation marks/);
  assert.match(prompt, /Keep captions under 90 words\./);
  assert.match(prompt, /ORIGINAL PLAN:/);
  assert.match(prompt, /REVISED PLAN:/);
  assert.match(buildRulePrompt(plan, plan, "x", []), /\(none yet\)/);
});

test("a durable rule is returned normalized", () => {
  assert.equal(parseStyleRule('{"rule":"  Never open a caption\\n  with a question.  "}'),
    "Never open a caption with a question.");
});

test("no-rule answers all collapse to an empty string", () => {
  for (const raw of ['{"rule":""}', '{"rule":"   "}', '{"rule":"No new rule required."}',
    '{"rule":"none"}', '{"other":"x"}', "not json", "null",
    `{"rule":"${"x".repeat(400)}"}`]) {
    assert.equal(parseStyleRule(raw), "", raw.slice(0, 30));
  }
});

test("merging puts the newest first, deduplicates, and caps the list", () => {
  assert.deepEqual(mergeStyleRules(["a"], "b"), ["b", "a"]);
  assert.deepEqual(mergeStyleRules(["a", "b"], "A"), ["A", "b"]);
  assert.deepEqual(mergeStyleRules(["a"], ""), ["a"]);
  const many = Array.from({ length: MAX_RULES }, (_, i) => `rule ${i}`);
  assert.equal(mergeStyleRules(many, "new").length, MAX_RULES);
  assert.equal(mergeStyleRules(many, "new")[0], "new");
});
