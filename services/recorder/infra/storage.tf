variable "bucket_name" { type = string }
variable "recorder_role_arn" { type = string }
variable "retention_days" {
  type = number
  default = 7
  validation {
    condition = var.retention_days >= 1 && var.retention_days <= 90
    error_message = "Pilot retention must be 1..90 days."
  }
}

resource "aws_kms_key" "audio" {
  description = "JewelOS recorder private audio"
  enable_key_rotation = true
  deletion_window_in_days = 30
}

resource "aws_s3_bucket" "audio" {
  bucket = var.bucket_name
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket = aws_s3_bucket.audio.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
      kms_master_key_id = aws_kms_key.audio.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule {
    id = "private-audio-retention"
    status = "Enabled"
    filter { prefix = "recordings/" }
    expiration { days = var.retention_days }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

resource "aws_s3_bucket_policy" "audio" {
  bucket = aws_s3_bucket.audio.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid = "DenyPlaintext"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [aws_s3_bucket.audio.arn, "${aws_s3_bucket.audio.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid = "RequireKmsOnWrites"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.audio.arn}/*"
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" } }
      },
      {
        Sid = "RequireThisKey"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.audio.arn}/*"
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.audio.arn } }
      }
    ]
  })
}

# Attach this policy ONLY to the dedicated task/instance role; no static AWS keys.
resource "aws_iam_policy" "recorder" {
  name_prefix = "jewelos-recorder-"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.audio.arn}/recordings/*"
      },
      {
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = aws_s3_bucket.audio.arn
      },
      {
        Effect = "Allow"
        Action = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.audio.arn
        Condition = {
          StringEquals = { "kms:ViaService" = "s3.${data.aws_region.current.region}.amazonaws.com" }
          StringLike = { "kms:EncryptionContext:aws:s3:arn" = [aws_s3_bucket.audio.arn, "${aws_s3_bucket.audio.arn}/recordings/*"] }
        }
      }
    ]
  })
}

data "aws_region" "current" {}
data "aws_arn" "role" { arn = var.recorder_role_arn }
resource "aws_iam_role_policy_attachment" "recorder" {
  role = element(reverse(split("/", data.aws_arn.role.resource)), 0)
  policy_arn = aws_iam_policy.recorder.arn
}

output "bucket" { value = aws_s3_bucket.audio.id }
output "kms_key_arn" { value = aws_kms_key.audio.arn }
