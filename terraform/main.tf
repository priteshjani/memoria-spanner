terraform {
  required_version = ">= 1.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Cloud Run v2 service
resource "google_cloud_run_v2_service" "demo_service" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "gcr.io/${var.project_id}/${var.service_name}:latest"
      
      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
      }
      
      ports {
        container_port = 8080
      }
      
      # Add environment variables if needed
      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
    }
  }
}

# Allow unauthenticated (public) access to the service
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  name     = google_cloud_run_v2_service.demo_service.name
  location = google_cloud_run_v2_service.demo_service.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
