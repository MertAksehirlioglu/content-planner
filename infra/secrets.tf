# The three secrets the functions bind at deploy time. Managing them here means a fork never
# runs `firebase functions:secrets:set` by hand, and rotating = edit a tfvar and re-apply.

locals {
  secrets = {
    ALLOWED_EMAILS = join(",", var.allowed_emails)
    ADMIN_EMAILS   = join(",", var.admin_emails)
    GEMINI_API_KEY = var.gemini_api_key
  }
}

resource "google_secret_manager_secret" "default" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = each.key

  replication { auto {} }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "default" {
  for_each = local.secrets

  secret      = google_secret_manager_secret.default[each.key].id
  secret_data = each.value

  # Keep the previous version alive briefly: functions pin a version at deploy time, so
  # destroying the old one immediately can break a running function until the next deploy.
  deletion_policy = "DISABLE"
}

# The functions runtime service account must be able to read them.
resource "google_secret_manager_secret_iam_member" "functions_access" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.default[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.project_id}@appspot.gserviceaccount.com"
}
