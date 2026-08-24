/** Validation for the client-supplied accountId. Dependency-free so it can be tested directly. */

/**
 * recordSpend interpolates accountId into a Firestore path *string*
 * (`users/{uid}/accounts/{accountId}/usage`), and Firestore parses `/` in such a string as a
 * segment separator. An accountId of `x/items/y` therefore reshapes the path so the usage doc
 * lands under firestore.rules' `items/{document=**}` match, which allows owner writes — letting
 * a user rewrite or delete their own spend history.
 *
 * So: exactly the shape Firestore's own auto-ids take (addDoc produces alphanumerics), plus the
 * separators our seeded ids use. No slashes, no dots, no `__reserved__` wrapping.
 */
export function isValidAccountId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
