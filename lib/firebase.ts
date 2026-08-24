import { getApps, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { GoogleAuthProvider, getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

/**
 * Every value here is a public identifier — a Firebase web config ships to each browser by
 * design, and so does the reCAPTCHA site key. They live in the environment not because they
 * are secret but because they name *which project this build talks to*: hardcoding them meant
 * a fork silently pointed at the original author's Firebase project.
 *
 * `infra/` provisions the project and prints this whole block:
 *   terraform -chdir=infra output -raw env_local > .env.local
 *
 * Access control is elsewhere and unchanged: App Check below, the beforeUserSignedIn
 * gatekeeper, and firestore.rules.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail at build/boot rather than at the first Firebase call, where the error surfaces as
    // an opaque auth/invalid-api-key from deep inside the SDK.
    throw new Error(
      `Missing ${name}. Run: terraform -chdir=infra output -raw env_local > .env.local ` +
        `(or copy .env.example and fill it in). See infra/README.md.`,
    );
  }
  return value;
}

const firebaseConfig = {
  apiKey: required("NEXT_PUBLIC_FIREBASE_API_KEY"),
  authDomain: required("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  projectId: required("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: required("NEXT_PUBLIC_FIREBASE_APP_ID"),
};

// Next re-runs modules on fast refresh; initializeApp twice throws.
export const app = getApps()[0] ?? initializeApp(firebaseConfig);

// App Check attaches an attestation token to every callable, so requests from outside this app
// are refused. Browser-only: the static export builds under Node, where window and reCAPTCHA
// don't exist.
if (typeof window !== "undefined") {
  if (window.location.hostname === "localhost") {
    // Prints a debug token to the console once; register it under App Check to test locally.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(required("NEXT_PUBLIC_RECAPTCHA_SITE_KEY")),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Firestore holds account state (business profiles + their saved/backlog items), owner-scoped
// by uid via firestore.rules. Safe under Node at build time — unlike App Check it needs no window.
export const db = getFirestore(app);

// Must match the region the functions declare in functions/src/*.ts, and infra's `region` var.
export const functions = getFunctions(
  app,
  process.env.NEXT_PUBLIC_FUNCTIONS_REGION ?? "europe-west1",
);
