// Fails the build if the Firebase web config did not get inlined into the bundle.
// Guards two real regressions that both shipped silently: a placeholder .env.local copied
// from .env.example, and a `required()` that read process.env dynamically so Next never
// substituted anything. Both produce a bundle that renders but throws on load.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "out/_next/static/chunks";
const bundle = readdirSync(dir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("");

const required = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_RECAPTCHA_SITE_KEY",
];

const problems = [];
for (const name of required) {
  const value = process.env[name];
  if (!value) problems.push(`${name} is not set in the environment`);
  else if (/^(my-project|123|1:123:web:abc)/.test(value))
    problems.push(`${name} still holds the .env.example placeholder ("${value}")`);
  else if (!bundle.includes(value))
    problems.push(`${name} never reached the bundle — read it as a static process.env.${name}`);
}

if (problems.length) {
  console.error("\nBuild rejected: the Firebase config is not usable in the browser.\n");
  for (const p of problems) console.error("  - " + p);
  console.error("\nFix .env.local (npx firebase apps:sdkconfig web), then rebuild.\n");
  process.exit(1);
}
console.log("check-build: Firebase config inlined correctly");
