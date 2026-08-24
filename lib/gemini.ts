/** Gemini calls, routed through the server proxy. Prompt assembly stays pure in plan.ts. */
import {
  DAYS, FORMATS, PLATFORMS, PUBLISHERS, SYSTEM, buildPrompt, parseContentPlan, parsePlan, parseStrategy,
  resolveFrequency, type ContentPlanResult, type Plan, type PlanRequest, type Strategy,
} from "@/lib/plan";
import { RULE_SYSTEM, buildRulePrompt, parseStyleRule } from "@/lib/rules";
import { usageSnapshot, type UsageSnapshot } from "@/lib/cost";
import { callGenerate } from "@/lib/generate-client";

const MODEL = "gemini-3.6-flash";
const ECONOMY_MODEL = "gemini-3.1-flash-lite";

// Plain-JSON Gemini responseSchema (REST format). Replaces firebase/ai's Schema builder now
// that the model call happens server-side. All object properties are required (matching the
// old builder's default), so the parsers never see a missing field.
type JsonSchema = Record<string, unknown>;
const str = (description?: string): JsonSchema =>
  description ? { type: "STRING", description } : { type: "STRING" };
const enumStr = (values: readonly string[]): JsonSchema =>
  ({ type: "STRING", format: "enum", enum: [...values] });
const arr = (items: JsonSchema, description?: string): JsonSchema =>
  description ? { type: "ARRAY", description, items } : { type: "ARRAY", items };
const obj = (properties: Record<string, JsonSchema>): JsonSchema =>
  ({ type: "OBJECT", properties, required: Object.keys(properties) });

const strategyItemProperties: Record<string, JsonSchema> = {
  id: str("Stable short id such as mon-linkedin-company."),
  day: enumStr(DAYS),
  platform: enumStr(PLATFORMS),
  publisher: enumStr(PUBLISHERS),
  objective: str(), category: str(),
  format: enumStr(FORMATS),
  source_asset: str("Exact supplied asset, or 'new asset needed'."),
  concept: str(),
  distinct_angle: str("Why this does not duplicate another item or recent post."),
};
const STRATEGY_SCHEMA = obj({
  week_theme: str(), rationale: str(),
  items: arr(obj(strategyItemProperties)),
});
const postProperties: Record<string, JsonSchema> = {
  ...strategyItemProperties,
  strategic_reason: str(), hook: str(), caption: str(),
  cta: str("Empty string when no CTA is appropriate."),
  hashtags: arr(str(), "0-8 specific hashtags with leading #."),
  creative_type: enumStr(["shoot", "existing_asset", "design", "ai_image", "none"]),
  creative_brief: str(), overlay_text: str(), aspect_ratio: str(),
  slides: arr(obj({ headline: str(), supporting_text: str(), visual_direction: str() })),
  assumptions: arr(str()),
  facts_to_verify: arr(str()),
};
const PLAN_SCHEMA = obj({ week_theme: str(), posts: arr(obj(postProperties)) });
const CONTENT_PLAN_SCHEMA = obj({ strategy: STRATEGY_SCHEMA, plan: PLAN_SCHEMA });
const RULE_SCHEMA = obj({
  rule: str("The durable rule, or an empty string when none applies."),
});

export interface GeneratedResult<T> { data: T; usage: UsageSnapshot; model: string }

export async function generateStrategy(req: PlanRequest, accountId?: string): Promise<GeneratedResult<Strategy>> {
  const request = { ...req, mode: "strategy" };
  const res = await callGenerate({
    model: MODEL, systemInstruction: SYSTEM, parts: [{ text: buildPrompt(request) }],
    responseMimeType: "application/json", responseSchema: STRATEGY_SCHEMA, operation: "strategy", accountId,
  });
  return { data: parseStrategy(res.text, resolveFrequency(request)), usage: usageSnapshot(res.usageMetadata), model: MODEL };
}

export async function generateContentPlan(req: PlanRequest, accountId?: string): Promise<GeneratedResult<ContentPlanResult>> {
  const request = { ...req, mode: "combined" };
  const res = await callGenerate({
    model: MODEL, systemInstruction: SYSTEM, parts: [{ text: buildPrompt(request) }],
    responseMimeType: "application/json", responseSchema: CONTENT_PLAN_SCHEMA, operation: "combined", accountId,
  });
  return { data: parseContentPlan(res.text, resolveFrequency(request)), usage: usageSnapshot(res.usageMetadata), model: MODEL };
}

export async function generatePlan(req: PlanRequest, economy = false, accountId?: string): Promise<GeneratedResult<Plan>> {
  const modelName = economy ? ECONOMY_MODEL : MODEL;
  const request = { ...req, mode: req.mode ?? "plan" };
  const res = await callGenerate({
    model: modelName, systemInstruction: SYSTEM, parts: [{ text: buildPrompt(request) }],
    responseMimeType: "application/json", responseSchema: PLAN_SCHEMA, operation: "plan", accountId,
  });
  return { data: parsePlan(res.text, resolveFrequency(request)), usage: usageSnapshot(res.usageMetadata), model: modelName };
}

/**
 * Turn one accepted revision into a durable editorial rule, or nothing. Best-effort:
 * callers fire and forget, so a failure here must never break the revision itself.
 */
export async function deriveStyleRule(
  previousPlan: Plan, revisedPlan: Plan, feedback: string, existingRules: string[], accountId?: string,
): Promise<string> {
  try {
    const res = await callGenerate({
      model: ECONOMY_MODEL, systemInstruction: RULE_SYSTEM,
      parts: [{ text: buildRulePrompt(previousPlan, revisedPlan, feedback, existingRules) }],
      responseMimeType: "application/json", responseSchema: RULE_SCHEMA, operation: "rule", accountId,
    });
    return parseStyleRule(res.text);
  } catch {
    return "";
  }
}
