output "service_url" {
  value       = google_cloud_run_v2_service.demo_service.uri
  description = "The public URL of the deployed Cloud Run service"
}
