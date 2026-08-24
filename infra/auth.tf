# Identity Platform. The `gatekeeper` blocking function is what actually enforces the
# allowlist; this file just makes sign-in exist and constrains it.

resource "google_identity_platform_config" "default" {
  provider = google-beta
  project  = var.project_id

  authorized_domains = local.authorized_domains

  sign_in {
    # Email/password stays off deliberately. The allowlist compares an email string, so a
    # self-serve password signup claiming an allowlisted address is exactly the bypass the
    # gatekeeper's emailVerified check exists to stop. Not offering it is the stronger fix.
    email {
      enabled           = false
      password_required = true
    }
    anonymous { enabled = false }

    # Two accounts sharing an email would let a second, unverified identity answer to an
    # allowlisted or admin address.
    allow_duplicate_emails = false
  }

  lifecycle {
    # `firebase deploy` registers the beforeUserSignedIn trigger for the gatekeeper as part of
    # deploying the function. If Terraform also managed this block the two would fight, and a
    # `terraform apply` after a deploy would quietly unregister the gatekeeper — removing the
    # allowlist entirely. Let the CLI own it.
    ignore_changes = [blocking_functions]
  }

  depends_on = [google_firebase_project.default]
}

# Google sign-in. Optional because an OAuth consent screen cannot be created by Terraform —
# see infra/README.md for the two-minute console alternative.
resource "google_identity_platform_default_supported_idp_config" "google" {
  count    = var.google_oauth_client_id == "" ? 0 : 1
  provider = google-beta
  project  = var.project_id

  enabled       = true
  idp_id        = "google.com"
  client_id     = var.google_oauth_client_id
  client_secret = var.google_oauth_client_secret

  depends_on = [google_identity_platform_config.default]
}
