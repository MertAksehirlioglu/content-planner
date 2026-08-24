output "web_app_id" {
  description = "Firebase web app id."
  value       = google_firebase_web_app.default.app_id
}

output "recaptcha_site_key" {
  description = "App Check site key. Public — it ships in the page."
  value       = google_recaptcha_enterprise_key.app_check.name
}

output "env_local" {
  description = <<-EOT
    The web app's build-time config. Write it to the repo root and both `npm run dev` and the
    static build will pick it up:

      terraform -chdir=infra output -raw env_local > .env.local

    Every value here is a public identifier that ships to the browser anyway; access control is
    App Check + the gatekeeper + firestore.rules, not secrecy of this file.
  EOT
  value       = <<-EOT
    NEXT_PUBLIC_FIREBASE_API_KEY=${data.google_firebase_web_app_config.default.api_key}
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${data.google_firebase_web_app_config.default.auth_domain}
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=${var.project_id}
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${lookup(data.google_firebase_web_app_config.default, "storage_bucket", "")}
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${lookup(data.google_firebase_web_app_config.default, "messaging_sender_id", "")}
    NEXT_PUBLIC_FIREBASE_APP_ID=${google_firebase_web_app.default.app_id}
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY=${google_recaptcha_enterprise_key.app_check.name}
    NEXT_PUBLIC_FUNCTIONS_REGION=${var.region}
  EOT
}

output "manual_steps" {
  description = "What Terraform could not do. Read this after the first apply."
  value = join("\n", compact([
    var.google_oauth_client_id == "" ? "Enable Google sign-in: Firebase console -> Authentication -> Sign-in method -> Google. (No Terraform resource creates an OAuth consent screen.)" : "",
    var.billing_account == "" ? "No budget created: set billing_account to bound project spend." : "",
    "Deploy the app: terraform -chdir=infra output -raw env_local > .env.local && npm run deploy",
  ]))
}
