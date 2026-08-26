/** The one call to the server proxy. Every browser->Gemini request goes through the
 *  `generate` callable now; prompt assembly, schemas, and parsing stay in the pure modules. */
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type GeminiPart = { text: string } | { inlineData: { data: string; mimeType: string } };

export interface GenerateRequest {
  model: string;
  parts: GeminiPart[];
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: unknown;
  responseModalities?: string[];
  imageConfig?: { aspectRatio?: string; imageSize?: string };
  // Which shared workspace this call is for. Required: the server verifies membership
  // before it spends anything, and writes the usage event under this workspace.
  workspaceId: string;
  operation?: string;
}

/** Raw Gemini usage block, converted to a UsageSnapshot client-side via lib/cost.ts. */
export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  candidatesTokensDetails?: Array<{ modality: string; tokenCount: number }>;
  cachedContentTokenCount?: number;
}

export interface GenerateResponse {
  text: string;
  inlineData?: { data: string; mimeType: string };
  usageMetadata: UsageMetadata;
  model: string;
}

const callable = httpsCallable<GenerateRequest, GenerateResponse>(functions, "generate");

export async function callGenerate(req: GenerateRequest): Promise<GenerateResponse> {
  const { data } = await callable(req);
  return data;
}
