# APIs, Firebase itself, and Firestore. Everything else in this module depends on these.

locals {
  services = [
    "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com",
    "firebase.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firebaserules.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "secretmanager.googleapis.com",
    "generativelanguage.googleapis.com", # the Gemini Developer API the proxy calls
    # Cloud Functions gen2 and what it builds/runs on
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "eventarc.googleapis.com",
    "run.googleapis.com",
  ]

  # Firebase serves the app from these two by default; sign-in and App Check must accept both,
  # plus localhost for `npm run dev`.
  authorized_domains = concat(
    ["localhost", "${var.project_id}.firebaseapp.com", "${var.project_id}.web.app"],
    var.extra_authorized_domains,
  )
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = var.project_id
  service = each.value

  # Leave APIs on when this module is destroyed: other things in the project may use them,
  # and re-enabling is free.
  disable_on_destroy = false
}

# Turns the plain GCP project into a Firebase project. Requires billing to already be linked
# (Blaze) — Identity Platform and gen2 functions both refuse on the free tier.
resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.enabled]
}

resource "google_firestore_database" "default" {
  provider = google-beta
  project  = var.project_id

  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  # Account data lives here. Make `terraform destroy` refuse rather than silently drop it.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"

  depends_on = [google_firebase_project.default]
}

# The web app whose config the browser bundle needs. `data.google_firebase_web_app_config`
# below is what replaces the values that used to be hardcoded in lib/firebase.ts.
resource "google_firebase_web_app" "default" {
  provider = google-beta
  project  = var.project_id

  display_name = "Weekly Content Planner"

  # Keep the app (and therefore its appId/apiKey) if this module is torn down; a new app id
  # would invalidate every existing App Check registration.
  deletion_policy = "ABANDON"

  depends_on = [google_firebase_project.default]
}

data "google_firebase_web_app_config" "default" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.default.app_id
}
