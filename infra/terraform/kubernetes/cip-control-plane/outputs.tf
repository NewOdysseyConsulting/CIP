output "namespace" {
  value       = kubernetes_namespace_v1.this.metadata[0].name
  description = "Namespace containing the CIP control-plane release."
}

output "release_name" {
  value       = helm_release.this.name
  description = "Helm release name."
}
