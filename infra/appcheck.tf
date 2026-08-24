# App Check: proves a call came from this app, not from someone replaying the public web config.
# Provisioning the reCAPTCHA key here is what turns App Check from "the biggest console chore"
# into a line of Terraform — which is why the app can keep enforcing it.

resource "google_recaptcha_enterprise_key" "app_check" {
  provider = google-beta
  project  = var.project_id

  display_name = "content-planner-app-check"

  web_settings {
    # SCORE, not CHECKBOX: App Check needs an invisible score-based key — a key that renders a
    # challenge widget cannot be used for attestation.
    integration_type  = "SCORE"
    allow_all_domains = false
    allowed_domains   = local.authorized_domains
  }

  depends_on = [google_project_service.enabled]
}

# App Check does not recognize a just-created web app immediately; binding without this fails.
resource "time_sleep" "wait_for_web_app" {
  depends_on      = [google_firebase_web_app.default]
  create_duration = "30s"
}

resource "google_firebase_app_check_recaptcha_enterprise_config" "default" {
  provider = google-beta
  project  = var.project_id

  app_id = google_firebase_web_app.default.app_id
  # The key's resource name IS the site key the browser embeds.
  site_key  = google_recaptcha_enterprise_key.app_check.name
  token_ttl = "3600s"

  depends_on = [time_sleep.wait_for_web_app]
}
