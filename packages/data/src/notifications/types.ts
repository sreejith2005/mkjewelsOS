import type { NotificationChannel, NotificationEventType, RecipientRule } from "@jewelos/core";

export type InboxNotification = Readonly<{
  id: string;
  event_type: string;
  title: string;
  message: string;
  link_url: string | null;
  is_read: boolean | null;
  read_at: string | null;
  priority: "low" | "medium" | "high";
  created_at: string | null;
}>;

export type NotificationTemplateRow = Readonly<{
  id: string;
  name: string;
  event_type: NotificationEventType;
  channel: NotificationChannel;
  title_template: string;
  body_template: string;
  link_url: string | null;
  is_active: boolean | null;
  lifecycle: string;
}>;

export type NotificationRuleRow = Readonly<{
  id: string;
  name: string;
  event_type: NotificationEventType;
  conditions: unknown;
  recipient_rules: unknown;
  channel_templates: unknown;
  delay_minutes: number;
  cooldown_minutes: number;
  max_attempts: number;
  backoff_minutes: number;
  priority: "low" | "medium" | "high";
  is_active: boolean | null;
  lifecycle: string;
}>;

export type ProviderAvailability = Readonly<{
  channel: NotificationChannel;
  is_available: boolean;
  provider_identifier: string | null;
  status_reason: string;
}>;

export type DeliveryLog = Readonly<{
  delivery_id: string;
  state: string;
  channel: NotificationChannel;
  event_type: string;
  recipient_label: string;
  attempt_count: number;
  max_attempts: number;
  error_category: string | null;
  scheduled_at: string;
  delivered_at: string | null;
  created_at: string;
}>;

export type RuleDraft = Readonly<{
  id?: string;
  name: string;
  eventType: NotificationEventType;
  conditions: readonly { field: string; operator: string; value?: string }[];
  recipients: readonly RecipientRule[];
  channelTemplates: Readonly<Record<string, string>>;
  delayMinutes: number;
  cooldownMinutes: number;
  maxAttempts: number;
  backoffMinutes: number;
  priority: "low" | "medium" | "high";
  enabled: boolean;
}>;
