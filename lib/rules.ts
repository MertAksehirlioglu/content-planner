/** Learned editorial rules: turn one accepted revision into a durable instruction.
 *  Pure — the model call lives in gemini.ts, so this stays offline-testable. */

import type { Plan } from "./plan.ts";

export const MAX_RULES = 20;
const MAX_RULE_LENGTH = 240;
const MAX_PLAN_CHARS = 12000;

export const RULE_SYSTEM = `You analyse one revision of a social content plan and decide whether the
owner's feedback expresses a lasting preference worth applying to every future plan.

Return {"rule": "..."} only when the preference is durable and post-independent — a standing
instruction about voice, structure, length, formatting, vocabulary, CTA style, or visual treatment.

Return {"rule": ""} when the feedback is specific to this week's subject matter, a one-off factual
correction, a request tied to a named event, product, or asset, or already covered by an existing
rule. When in doubt return an empty string: a wrong standing rule corrupts every future plan.

Write the rule as one imperative sentence addressed to the writer, under 200 characters, with no
reference to this particular post, week, or plan.`;

function compact(value: unknown): string {
  try { return JSON.stringify(value).slice(0, MAX_PLAN_CHARS); } catch { return ""; }
}

export function buildRulePrompt(
  previousPlan: Plan, revisedPlan: Plan, feedback: string, existingRules: string[],
): string {
  return [
    "EXISTING RULES (do not restate or narrow these):",
    existingRules.length ? existingRules.map((rule) => `- ${rule}`).join("\n") : "(none yet)",
    "", "ORIGINAL PLAN:", compact(previousPlan),
    "", "REVISED PLAN:", compact(revisedPlan),
    "", `THE OWNER ASKED FOR: ${feedback.trim().slice(0, 2000)}`,
    "", "Is there a durable rule here?",
  ].join("\n");
}

/** Empty string means "no durable rule" — the common and correct answer. */
export function parseStyleRule(raw: string): string {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return ""; }
  if (typeof value !== "object" || value === null) return "";
  const rule = (value as Record<string, unknown>).rule;
  if (typeof rule !== "string") return "";
  const trimmed = rule.trim().replace(/\s+/g, " ");
  // Models like to answer the question in prose instead of returning nothing.
  if (!trimmed || trimmed.length > MAX_RULE_LENGTH || /^(no|none|n\/a)\b/i.test(trimmed)) return "";
  return trimmed;
}

/** Newest first, case-insensitively deduplicated, capped. */
export function mergeStyleRules(existing: string[], rule: string): string[] {
  if (!rule) return existing;
  const key = rule.toLowerCase();
  return [rule, ...existing.filter((value) => value.toLowerCase() !== key)].slice(0, MAX_RULES);
}
