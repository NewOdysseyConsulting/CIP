variable "namespace" {
  type        = string
  description = "Kubernetes namespace for the CIP control plane."
  default     = "cip-control-plane"
}

variable "release_name" {
  type        = string
  description = "Helm release name."
  default     = "cip-control-plane"
}

variable "chart_path" {
  type        = string
  description = "Path to the Helm chart."
  default     = "../../../helm/cip-control-plane"
}

variable "postgres_secret_name" {
  type        = string
  description = "Secret containing the Postgres connection string."
  default     = "cip-control-plane-postgres"
}

variable "operator_secret_name" {
  type        = string
  description = "Secret containing the operator shared secret."
  default     = "cip-control-plane-operator"
}

variable "api_image" {
  type        = string
  description = "API service image reference."
  default     = "ghcr.io/new-odyssey/cip-control-plane-api:0.1.0"
}

variable "worker_image" {
  type        = string
  description = "Worker service image reference."
  default     = "ghcr.io/new-odyssey/cip-control-plane-worker:0.1.0"
}

variable "migrate_image" {
  type        = string
  description = "Migration service image reference."
  default     = "ghcr.io/new-odyssey/cip-control-plane-migrate:0.1.0"
}
