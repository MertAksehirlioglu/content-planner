# The spend backstop. The app transactionally reserves per-user spend before each model call,
# but a Cloud Billing budget provides an independent alert if the app or its pricing assumptions
# are wrong. Budgets alert; they do not automatically disable billing.

data "google_billing_account" "default" {
  count           = var.billing_account == "" ? 0 : 1
  billing_account = var.billing_account
}

resource "google_billing_budget" "default" {
  count = var.billing_account == "" ? 0 : 1

  billing_account = data.google_billing_account.default[0].id
  display_name    = "content-planner (${var.project_id})"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  # Alerts only — a budget cannot itself stop spend. To make it hard, wire the Pub/Sub topic
  # these publish to into a function that disables billing. Documented, not built: pulling
  # billing out from under a live project is a bigger hammer than a solo planner needs.
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.enabled]
}
