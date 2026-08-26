import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";

import { costUsd, isBillableModel, monthKey, reserveUsd, usageSnapshot } from "./cost.js";
import { remainingUsd } from "./budget.js";
import { releaseSpend, reserveSpend, settleSpend } from "./billing-store.js";
import { assertMember } from "./workspace-store.js";

/** Gemini Developer API key. A secret (not a param) so it stays out of the repo and can be
 *  rotated without a code change. This is what replaces the browser's Firebase AI Logic
 *  path: the key now lives only on the server, and every call goes through this chokepoint. */
const geminiApiKey = defineSecret("GEMINI_API_KEY");

/** One user->model part. The client builds these (text, or an inline image for style refs);
 *  the server never inspects prompt content, it only meters and forwards. */
type Part = { text?: string; inlineData?: { data: string; mimeType: string } };

interface GenerateData {
  model: string;
  parts: Part[];
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: unknown;
  responseModalities?: string[];
  imageConfig?: { aspectRatio?: string; imageSize?: string };
  // Which shared workspace this call is for. Required: the usage event it produces is
  // workspace-scoped, and a missing id used to fall back to an "unknown" bucket that no
  // membership check can pass.
  workspaceId?: string;
  operation?: string;
}

/**
 * The sole browser->Gemini path. App Check + auth gate it (same trust boundary the AI Logic
 * calls had), and the API key stays server-side. Kept deliberately dumb — a metered pipe:
 * prompt assembly, response schemas, and parsing all remain in the pure client modules.
 * The budget layer wraps this with a pre-check and spend recording (see the budget plan).
 */
export const generate = onCall(
  // maxInstances bounds the blast radius of junk traffic: the endpoint must be publicly
  // invocable for the browser callable protocol, so anyone can *reach* it and be rejected
  // by App Check/auth. Those rejections still bill invocations; this caps how many can run
  // at once. Raise it if real users ever queue behind the limit.
  { secrets: [geminiApiKey], region: "europe-west1", enforceAppCheck: true, maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const data = request.data as GenerateData | undefined;
    if (!data?.model || !Array.isArray(data.parts) || data.parts.length === 0) {
      throw new HttpsError("invalid-argument", "model and a non-empty parts array are required.");
    }
    // The client only ever sends models from BILLABLE_MODELS. Anything else has no rate, so
    // it would run on the owner's key and bill $0 — an unmetered call that walks straight
    // past the budget check below.
    if (!isBillableModel(data.model)) {
      throw new HttpsError("invalid-argument", "Unsupported model.");
    }

    const uid = request.auth.uid;
    const workspaceId = data.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId === "") {
      throw new HttpsError("invalid-argument", "workspaceId is required.");
    }
    const operation = typeof data.operation === "string" ? data.operation : "generate";
    const month = monthKey(new Date());
    const db = getFirestore();

    // Before the budget hold, not after: a rejected non-member must not leave a hold behind.
    // Budgets stay keyed by uid, so this is not what stops one user spending another's money
    // — it stops a signed-in stranger writing usage events into someone else's workspace.
    await assertMember(db, workspaceId, uid);

    // (a) Check the cap and take a hold in one transaction, BEFORE spending anything. Doing
    // these as separate read/write steps is what let concurrent calls all pass the same check;
    // the hold is refunded in (b) or released if the call fails.
    const reserve = reserveUsd(data.model);
    const { ok, monthlyUsd, spentUsd } = await reserveSpend(db, uid, month, reserve);
    if (!ok) {
      throw new HttpsError("resource-exhausted", "Monthly budget reached. Contact the owner to raise it.");
    }

    const config: GenerateContentConfig = {};
    if (data.systemInstruction) config.systemInstruction = data.systemInstruction;
    if (data.responseMimeType) config.responseMimeType = data.responseMimeType;
    if (data.responseSchema) config.responseSchema = data.responseSchema;
    if (data.responseModalities) config.responseModalities = data.responseModalities;
    // imageConfig's imageSize is a string enum in the SDK types; the client already sends a
    // valid value ("1K"), so pass it through without re-deriving the enum here.
    if (data.imageConfig) config.imageConfig = data.imageConfig as GenerateContentConfig["imageConfig"];

    const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
    let response;
    try {
      response = await ai.models.generateContent({
        model: data.model,
        contents: [{ role: "user", parts: data.parts }],
        config,
      });
    } catch (err) {
      // Nothing was spent, so the hold must go back or a failing model would eat the budget.
      await releaseSpend(db, uid, month, reserve).catch((releaseErr) => {
        logger.error("Failed to release budget hold", {
          errorType: releaseErr instanceof Error ? releaseErr.name : typeof releaseErr,
        });
      });
      // SDK messages can include upstream response and request details. Keep those out of logs;
      // the error type is enough to correlate failures without risking credential disclosure.
      logger.error("Gemini call failed", {
        errorType: err instanceof Error ? err.name : typeof err,
      });
      throw new HttpsError("internal", "The model call failed.");
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((p) => p.inlineData)?.inlineData;
    const inlineData = inline?.data
      ? { data: inline.data, mimeType: inline.mimeType ?? "image/png" }
      : undefined;

    // (b) Settle: swap the hold for the real charge. costUsd is the authoritative number, and
    // the hold is deliberately generous, so this is usually a refund.
    const usage = usageSnapshot(response.usageMetadata);
    const imageCount = parts.filter((p) => p.inlineData).length;
    const cost = costUsd(data.model, usage, imageCount);
    await settleSpend(db, {
      uid, workspaceId, month, reserve, actual: cost,
      event: { operation, model: data.model, usage, imageCount, estimatedUsd: cost },
    });

    return {
      text: response.text ?? "",
      inlineData,
      usageMetadata: response.usageMetadata ?? {},
      model: data.model,
      remainingUsd: remainingUsd(monthlyUsd, spentUsd + cost),
    };
  },
);
