terraform {
  required_version = ">= 1.5"

  required_providers {
    # Most Firebase resources are beta-only, so nearly everything below uses google-beta.
    google      = { source = "hashicorp/google", version = ">= 6.0" }
    google-beta = { source = "hashicorp/google-beta", version = ">= 6.0" }
    time        = { source = "hashicorp/time", version = ">= 0.11" }
  }

  # State is local by default: one operator, one project. Point this at a GCS bucket if
  # more than one person will ever run apply.
  # backend "gcs" { bucket = "my-tfstate" prefix = "content-planner" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
