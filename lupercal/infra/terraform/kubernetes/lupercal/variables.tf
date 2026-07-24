variable "namespace" {
  type        = string
  description = "Kubernetes namespace for the Lupercal control plane."
  default     = "lupercal"
}

variable "release_name" {
  type        = string
  description = "Helm release name."
  default     = "lupercal"
}

variable "chart_path" {
  type        = string
  description = "Path to the Helm chart."
  default     = "../../../helm/lupercal"
}

variable "postgres_secret_name" {
  type        = string
  description = "Secret containing the Postgres connection string."
  default     = "lupercal-postgres"
}

variable "operator_secret_name" {
  type        = string
  description = "Secret containing the operator shared secret."
  default     = "lupercal-operator"
}

variable "api_image" {
  type        = string
  description = "API service image reference."
  default     = "ghcr.io/new-odyssey/lupercal-api:0.3.0-alpha.0"
}

variable "worker_image" {
  type        = string
  description = "Worker service image reference."
  default     = "ghcr.io/new-odyssey/lupercal-worker:0.3.0-alpha.0"
}

variable "migrate_image" {
  type        = string
  description = "Migration service image reference."
  default     = "ghcr.io/new-odyssey/lupercal-migrate:0.3.0-alpha.0"
}

variable "operator_auth_mode" {
  type        = string
  description = "Operator auth mode for the control plane."
  default     = "hs256"
}

variable "operator_issuer" {
  type        = string
  description = "Expected JWT issuer for operator tokens."
  default     = "lupercal-control-plane"
}

variable "operator_audience" {
  type        = string
  description = "Expected JWT audience for operator tokens."
  default     = "lupercal-operators"
}

variable "operator_jwks_url" {
  type        = string
  description = "JWKS URL used when operator_auth_mode is jwks-rs256."
  default     = ""
}

variable "worker_poll_interval_ms" {
  type        = string
  description = "Worker poll interval in milliseconds."
  default     = "1000"
}

variable "worker_max_attempts" {
  type        = string
  description = "Maximum worker retry attempts before dead lettering."
  default     = "5"
}

variable "retention_window_hours" {
  type        = string
  description = "Retention window for idempotency, ingest, and dead-letter records."
  default     = "168"
}

variable "retention_sweep_every_loops" {
  type        = string
  description = "How often the worker runs retention cleanup."
  default     = "300"
}
