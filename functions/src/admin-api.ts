import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { isAllowed } from "./allowlist.js";
import { monthKey } from "./cost.js";
import { remainingUsd } from "./budget.js";
import { readBudgetState } from "./billing-store.js";

/** Who may set budgets / view all users. Comma-separated, in Secret Manager, mirroring
 *  ALLOWED_EMAILS. Fails closed via isAllowed: empty list grants admin to nobody. */
const adminEmails = defineSecret("ADMIN_EMAILS");
const OPTS = { secrets: [adminEmails], region: "europe-west1" as const, enforceAppCheck: true };

/**
 * email_verified is not optional here. `gatekeeper` runs at sign-in only, never on the hourly
 * ID-token refresh, so its verified-email check does not hold for the life of a session: a
 * signed-in user can call updateEmail() to an ADMIN_EMAILS address and refresh into a token
 * carrying that email with email_verified false. Requiring the claim closes that path.
 */
function assertAdmin(request: { auth?: { token?: { email?: string; email_verified?: boolean } } }): void {
  const token = request.auth?.token;
  if (token?.email_verified !== true || !isAllowed(token.email, adminEmails.value())) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

export const setBudget = onCall(OPTS, async (request) => {
  assertAdmin(request);
  const { uid, monthlyUsd } = (request.data ?? {}) as { uid?: unknown; monthlyUsd?: unknown };
  if (typeof uid !== "string" || uid.trim() === "") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  if (typeof monthlyUsd !== "number" || !Number.isFinite(monthlyUsd) || monthlyUsd < 0) {
    throw new HttpsError("invalid-argument", "monthlyUsd must be a number >= 0.");
  }
  await getFirestore().doc(`users/${uid}/billing/budget`).set({
    monthlyUsd, updatedBy: request.auth?.token?.email ?? "admin", updatedAt: Date.now(),
  }, { merge: true });
  return { ok: true as const };
});

export const listUsers = onCall(OPTS, async (request) => {
  assertAdmin(request);
  const db = getFirestore();
  const month = monthKey(new Date());
  const { users } = await getAuth().listUsers(1000);
  const rows = await Promise.all(users.map(async (u) => {
    const { monthlyUsd, spentUsd } = await readBudgetState(db, u.uid, month);
    return {
      uid: u.uid, email: u.email ?? "(no email)",
      monthlyUsd, spentUsd, remainingUsd: remainingUsd(monthlyUsd, spentUsd),
    };
  }));
  return { users: rows };
});
