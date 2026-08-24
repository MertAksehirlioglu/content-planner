variable "project_id" {
  description = "Existing GCP project id to turn into the planner's Firebase project."
  type        = string
}

variable "region" {
  description = <<-EOT
    Region for Cloud Functions. Must match the region hardcoded on the functions themselves
    (functions/src/*.ts pass `region:` explicitly) — a mismatch means the browser calls a
    URL that does not exist.
  EOT
  type        = string
  default     = "europe-west1"
}

variable "firestore_location" {
  description = "Firestore location. Cannot be changed after creation. e.g. eur3, nam5, us-central1."
  type        = string
  default     = "eur3"
}

variable "allowed_emails" {
  description = "Emails permitted to sign in. Becomes the ALLOWED_EMAILS secret; empty allows nobody."
  type        = list(string)
}

variable "admin_emails" {
  description = "Emails permitted to view usage and set budgets. Becomes the ADMIN_EMAILS secret."
  type        = list(string)
  default     = []
}

variable "gemini_api_key" {
  description = <<-EOT
    Gemini Developer API key, from https://aistudio.google.com/apikey. This is the one value
    Terraform cannot create for you — AI Studio has no API. Becomes the GEMINI_API_KEY secret.
  EOT
  type        = string
  sensitive   = true
}

variable "google_oauth_client_id" {
  description = <<-EOT
    OAuth client id for Google sign-in. Leave empty to configure the Google provider by hand in
    the Firebase console instead — creating an OAuth consent screen has no Terraform resource,
    so a fully hands-off Google provider is not possible. See infra/README.md.
  EOT
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "OAuth client secret matching google_oauth_client_id."
  type        = string
  default     = ""
  sensitive   = true
}

variable "extra_authorized_domains" {
  description = "Additional domains allowed to complete sign-in and pass App Check (custom domains)."
  type        = list(string)
  default     = []
}

variable "billing_account" {
  description = <<-EOT
    Billing account id (e.g. 01ABCD-234567-89EFGH). Required only for the spend cap in budget.tf.
    Leave empty to skip the budget — but then nothing bounds what a runaway loop can spend.
  EOT
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Project-wide monthly spend that triggers budget alerts. The backstop under the app's own per-user cap."
  type        = number
  default     = 25
}
