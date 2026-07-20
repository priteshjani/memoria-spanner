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

# Artifact Registry Repository
resource "google_artifact_registry_repository" "demo_repo" {
  location      = var.region
  repository_id = "cloudscript-repo"
  description   = "Docker repository for Memoria Spanner demo"
  format        = "DOCKER"
}

# Cloud Spanner Instance
resource "google_spanner_instance" "spanner_instance" {
  config       = "regional-${var.region}"
  display_name = "Memoria Spanner Demo Instance"
  name         = var.spanner_instance_id
  # 100 processing units = 0.1 node, cost-effective for demo
  processing_units = 100
}

# Cloud Spanner Database
resource "google_spanner_database" "spanner_database" {
  instance = google_spanner_instance.spanner_instance.name
  name     = var.spanner_database_id
}

# Service Account for Cloud Run
resource "google_service_account" "run_sa" {
  account_id   = "${var.service_name}-runner"
  display_name = "Service Account for Memoria Spanner Cloud Run"
}

# IAM role to invoke Vertex AI models
resource "google_project_iam_member" "vertex_ai_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.run_sa.email}"
}

# IAM role to access Spanner database and manage schema (needed for dynamic wipe/seed)
resource "google_project_iam_member" "spanner_admin" {
  project = var.project_id
  role    = "roles/spanner.databaseAdmin"
  member  = "serviceAccount:${google_service_account.run_sa.email}"
}

# Cloud Run v2 service
resource "google_cloud_run_v2_service" "demo_service" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.run_sa.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.demo_repo.repository_id}/${var.service_name}:latest"
      
      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
      }
      
      ports {
        container_port = 8080
      }
      
      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "SPANNER_INSTANCE"
        value = google_spanner_instance.spanner_instance.name
      }
      env {
        name  = "SPANNER_DATABASE"
        value = google_spanner_database.spanner_database.name
      }
    }
  }

  depends_on = [
    google_spanner_database.spanner_database,
    google_artifact_registry_repository.demo_repo
  ]
}

# Allow unauthenticated (public) access to the service
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  name     = google_cloud_run_v2_service.demo_service.name
  location = google_cloud_run_v2_service.demo_service.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
