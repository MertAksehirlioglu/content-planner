# Provisioning

Everything the planner needs on Google Cloud, as code. `terraform apply` replaces roughly a
dozen console visits: APIs, Firestore, the web app, the reCAPTCHA Enterprise key, App Check,
Identity Platform, all three Secret Manager secrets, and a spend budget.

## Prerequisites

- Node.js 22 and npm
- Terraform 1.5+
- Google Cloud CLI (`gcloud`)
- A GCP project with a linked billing account (Blaze)
- A Gemini Developer API key

Authenticate the CLI and Terraform provider before applying:

```sh
gcloud auth login
gcloud auth application-default login
```

## What Terraform cannot do

Two things have no Terraform resource. Both are one-time and take about a minute each.

| Step | Why it's manual |
|---|---|
| **Gemini API key** | Created in [AI Studio](https://aistudio.google.com/apikey), which has no API. Paste it into `gemini_api_key` and Terraform stores it in Secret Manager. |
| **Google sign-in** | Enabling the `google.com` provider needs an OAuth client, and creating an OAuth *consent screen* has no Terraform resource. Either flip it on in Firebase console → Authentication → Sign-in method → Google (easiest), or create an OAuth client yourself and set `google_oauth_client_id` / `google_oauth_client_secret`. |

Project creation and billing are also assumed done — an individual account usually cannot
create projects under an org from Terraform anyway:

```sh
gcloud projects create my-content-planner
gcloud billing projects link my-content-planner --billing-account=01ABCD-234567-89EFGH
```

Blaze (a linked billing account) is required, not optional: Identity Platform and gen2
Cloud Functions both refuse to provision on the free tier.

## Apply

```sh
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill in project_id, emails, gemini_api_key
terraform init
terraform apply
```

`terraform.tfvars` and all local state files are ignored by Git. They still contain secrets in
plaintext: Terraform's `sensitive` flag hides values from normal terminal output but does not
encrypt state. Keep the working directory on encrypted storage, restrict access to any remote
state backend, and never attach state or plan files to a public issue.

Then wire the app to what was just created and deploy:

```sh
cd ..
npm ci
npm --prefix functions ci
terraform -chdir=infra output -raw env_local > .env.local
npx firebase use my-content-planner
npm run deploy
```

`terraform output manual_steps` lists whatever is still left for you.

## Things worth knowing before you apply

- **`firestore_location` is permanent.** It cannot be changed after the database exists;
  moving regions means a new project. `eur3` and `nam5` are the multi-region choices.
- **`region` must match the functions.** `functions/src/*.ts` pass `region: "europe-west1"`
  explicitly. Change one and you must change the other, or the browser calls a URL that
  doesn't exist.
- **Terraform does not own the blocking-function trigger.** `firebase deploy` registers the
  `gatekeeper` when it deploys the function, and `auth.tf` deliberately
  `ignore_changes = [blocking_functions]`. Without that, a `terraform apply` after a deploy
  would unregister the gatekeeper — silently removing the allowlist, which is the app's only
  real access control. Don't "clean up" that lifecycle block.
- **The budget alerts, it does not stop spend.** A `google_billing_budget` sends
  notifications; capping for real means wiring its Pub/Sub topic to a function that unlinks
  billing. The app transactionally reserves against its per-user cap before each model call,
  but the final accepted call can exceed its conservative reservation. Treat the billing
  budget as the independent outer alert and set `billing_account` rather than leaving it empty.
- **Rotating a secret** is a tfvar edit plus `terraform apply`, then a redeploy of the
  functions so they pick up the new version.
- **`terraform destroy` will refuse** while Firestore has delete protection on, which is
  intentional — that database holds every account's content.

## Cost

Idle is effectively free: Hosting is free at this size, functions scale to zero, Firestore
stays in free-tier territory for a handful of users, and reCAPTCHA Enterprise gives 10k
assessments/month free. The real spend is Gemini tokens and generated images, which the app
meters per user.
