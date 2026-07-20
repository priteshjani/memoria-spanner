variable "project_id" {
  type        = string
  description = "The target GCP Project ID"
}

variable "region" {
  type        = string
  default     = "us-west4"
  description = "The target deployment region"
}

variable "service_name" {
  type        = string
  default     = "memoria-spanner"
  description = "The name of the Cloud Run v2 service"
}

variable "spanner_instance_id" {
  type        = string
  default     = "memoria-spanner-inst"
  description = "The ID of the Spanner instance to create"
}

variable "spanner_database_id" {
  type        = string
  default     = "memoria-spanner-db"
  description = "The ID of the Spanner database to create"
}
