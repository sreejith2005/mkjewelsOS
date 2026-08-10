# Notification outbox worker

This function is invoked only by an authenticated server-side scheduler. Local
configuration uses environment variables; never put values in source control:

- `NOTIFICATION_OUTBOX_CRON_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The request uses `x-cron-secret` and an optional JSON `batch_size` from 1 to
100. Responses contain aggregate counts only. In-app delivery is available.
Email, WhatsApp, SMS, and push remain `blocked_configuration` until an approved
provider adapter and secret-manager configuration are implemented and tested.

No remote cron job is created by this module. A future reviewed scheduler may
invoke both scheduled event detection and outbox processing through this one
worker using the existing Vault-backed secret pattern.
