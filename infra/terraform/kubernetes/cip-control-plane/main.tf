resource "kubernetes_namespace_v1" "this" {
  metadata {
    name = var.namespace
  }
}

locals {
  api_image_parts     = split(":", var.api_image)
  worker_image_parts  = split(":", var.worker_image)
  migrate_image_parts = split(":", var.migrate_image)
}

resource "helm_release" "this" {
  name       = var.release_name
  namespace  = kubernetes_namespace_v1.this.metadata[0].name
  chart      = "${path.module}/${var.chart_path}"
  depends_on = [kubernetes_namespace_v1.this]

  values = [
    yamlencode({
      images = {
        api = {
          repository = local.api_image_parts[0]
          tag        = try(local.api_image_parts[1], "latest")
        }
        worker = {
          repository = local.worker_image_parts[0]
          tag        = try(local.worker_image_parts[1], "latest")
        }
        migrate = {
          repository = local.migrate_image_parts[0]
          tag        = try(local.migrate_image_parts[1], "latest")
        }
      }
      existingSecrets = {
        postgres = var.postgres_secret_name
        operator = var.operator_secret_name
      }
    })
  ]
}
