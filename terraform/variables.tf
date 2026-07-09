variable "project_id" {
  type        = string
  description = "The target GCP Project ID"
}

variable "region" {
  type        = string
  default     = "us-east4"
  description = "The target deployment region"
}

variable "service_name" {
  type        = string
  default     = "demo-scaffolding-service"
  description = "The name of the Cloud Run v2 service"
}
