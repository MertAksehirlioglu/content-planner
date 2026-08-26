import { beforeUserSignedIn, HttpsError } from "firebase-functions/v2/identity";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";

import { isAllowed } from "./allowlist.js";

// Initialize the Admin SDK once at cold start — the proxy and admin callables use it. Runs
// before any handler fires (handlers call getFirestore()/getAuth() at request time).
if (!getApps().length) initializeApp();

export { generate } from "./generate.js";
export { setBudget, listUsers } from "./admin-api.js";
export { createWorkspace, addMember, removeMember } from "./workspace-api.js";

/** Comma-separated emails allowed to sign in. A secret rather than a plain param so the
 *  list stays out of the repo and can be rotated without redeploying the code. */
const allowedEmails = defineSecret("ALLOWED_EMAILS");

/**
 * Runs on every sign-in before a session is issued. Anyone outside the allowlist is
 * refused here, so a valid session only ever exists for an approved account — which is
 * what makes the client-side Gemini calls safe to restrict to authenticated users.
 *
 * isAllowed fails closed: an empty or unparseable list refuses everyone.
 *
 * The email must also be verified. The allowlist compares a string, so without this an
 * unverified email/password (or Microsoft-style) signup claiming an allowlisted address
 * would satisfy it — a full bypass of the only access control this app has. Google
 * sign-in always reports emailVerified, so the intended provider is unaffected.
 */
export const gatekeeper = beforeUserSignedIn(
  { secrets: [allowedEmails], region: "europe-west1" },
  (event) => {
    const email = event.data?.email?.toLowerCase();
    if (!event.data?.emailVerified || !isAllowed(email, allowedEmails.value())) {
      // Do not put the rejected address in logs: it is unnecessary PII and can be attacker
      // controlled. Firebase's request metadata is enough to investigate abuse.
      logger.warn("Refused sign-in outside the allowlist");
      throw new HttpsError("permission-denied", "This account isn't allowed to use this app.");
    }
  },
);
