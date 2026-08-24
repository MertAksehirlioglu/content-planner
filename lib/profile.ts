/** The business profile the browser keeps in localStorage, and how to read it safely. */

export const DEFAULT_CATEGORIES = [
  "Behind the scenes", "Product spotlight", "Promo / offer", "Tips & how-to",
  "Client story / testimonial", "Industry take", "Seasonal / trending",
];

export interface Profile {
  business: string;
  audience: string;
  tone: string;
  language: string;
  products: string;
  founderVoice: string;
  visualIdentity: string;
  approvedFacts: string;
  avoid: string;
  platforms: ("instagram" | "linkedin")[];
  publishers: ("company" | "founder")[];
  frequency: number;
  allCategories: string[];
  categories: string[];
  /** Learned from past revisions; see lib/rules.ts. Owner-editable, never required. */
  styleRules: string[];
}

export const EMPTY_PROFILE: Profile = {
  business: "",
  audience: "",
  tone: "",
  language: "English",
  products: "",
  founderVoice: "",
  visualIdentity: "",
  approvedFacts: "",
  avoid: "",
  platforms: ["instagram"],
  publishers: ["company"],
  frequency: 3,
  allCategories: DEFAULT_CATEGORIES,
  categories: DEFAULT_CATEGORIES.slice(0, 4),
  styleRules: [],
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const strList = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;

const enumList = <T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] =>
  Array.isArray(v)
    ? v.filter((x): x is T => typeof x === "string" && allowed.includes(x as T))
    : fallback;

/**
 * localStorage may hold a profile written by an older version of this app, or nothing,
 * or junk — so validate every field rather than trusting the shape. An unreadable field
 * falls back to its default instead of failing the whole read.
 *
 * The pre-Next UI wrote `all_categories`; carry that over so an owner who already added
 * custom categories keeps them.
 */
export function normalizeProfile(raw: string | undefined | null): Profile {
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? "");
  } catch {
    return EMPTY_PROFILE;
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) {
    return EMPTY_PROFILE;
  }

  const o = saved as Record<string, unknown>;
  const freq = o.frequency;

  return {
    business: str(o.business),
    audience: str(o.audience),
    tone: str(o.tone),
    language: str(o.language) || EMPTY_PROFILE.language,
    products: str(o.products),
    founderVoice: str(o.founderVoice),
    visualIdentity: str(o.visualIdentity),
    approvedFacts: str(o.approvedFacts),
    avoid: str(o.avoid),
    platforms: enumList(o.platforms, ["instagram", "linkedin"] as const, EMPTY_PROFILE.platforms),
    publishers: enumList(o.publishers, ["company", "founder"] as const, EMPTY_PROFILE.publishers),
    frequency:
      typeof freq === "number" && Number.isInteger(freq) && freq >= 1 && freq <= 7 ? freq : 3,
    allCategories: strList(o.allCategories ?? o.all_categories, DEFAULT_CATEGORIES),
    categories: strList(o.categories, EMPTY_PROFILE.categories),
    styleRules: strList(o.styleRules, []),
  };
}
