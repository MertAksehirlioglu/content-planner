/** Who may generate plans. Kept dependency-free so it can be tested directly. */

/**
 * Exact, case-insensitive membership. Deliberately not a substring, suffix, or domain
 * match: `evil@notmydomain.com` must never satisfy an entry of `me@mydomain.com`, and
 * `me+anything@x.com` is a different address than `me@x.com`.
 *
 * Fails closed — an empty or unparseable list allows nobody, so a misconfigured
 * deployment refuses everyone rather than opening the door.
 */
export function isAllowed(email: string | undefined | null, rawList: string | undefined): boolean {
  const allowed = parseAllowList(rawList);
  if (allowed.length === 0) return false;
  if (typeof email !== "string" || email.trim() === "") return false;
  return allowed.includes(email.trim().toLowerCase());
}

export function parseAllowList(rawList: string | undefined | null): string[] {
  if (typeof rawList !== "string") return [];
  return rawList
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}
