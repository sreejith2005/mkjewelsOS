import { supabase } from "@jewelos/api-client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Json } from "@jewelos/core";
import type {
  DeliveryLog,
  InboxNotification,
  NotificationRuleRow,
  NotificationTemplateRow,
  ProviderAvailability,
  RuleDraft,
} from "./types";

export async function loadInbox(profileId: string, limit = 200): Promise<InboxNotification[]> {
  const { data, error } = await supabase.from("notifications").select("id,event_type,title,message,link_url,is_read,read_at,priority,created_at").eq("user_profile_id", profileId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as InboxNotification[];
}

export async function markNotification(notificationId: string, isRead: boolean): Promise<void> {
  const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: notificationId, p_is_read: isRead });
  if (error) throw error;
}

export async function markAllNotifications(): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
  return Number(data ?? 0);
}

export function subscribeToInbox(profileId: string, refresh: () => void): () => void {
  const channel: RealtimeChannel = supabase.channel(`notifications:${profileId}`).on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "notifications", filter: `user_profile_id=eq.${profileId}` },
    refresh,
  ).subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export async function loadTemplates(): Promise<NotificationTemplateRow[]> {
  const { data, error } = await supabase.from("notification_templates").select("id,name,event_type,channel,title_template,body_template,link_url,is_active,lifecycle").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as NotificationTemplateRow[];
}

export async function saveTemplate(input: Omit<NotificationTemplateRow, "id" | "lifecycle"> & { id?: string }): Promise<string> {
  const { data, error } = await supabase.rpc("save_notification_template", {
    p_template_id: input.id as string,
    p_name: input.name,
    p_event_type: input.event_type,
    p_channel: input.channel,
    p_title_template: input.title_template,
    p_body_template: input.body_template,
    p_link_url: input.link_url as string,
    p_is_active: input.is_active ?? true,
  });
  if (error) throw error;
  return data as string;
}

export async function archiveTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc("archive_notification_template", { p_template_id: id });
  if (error) throw error;
}

export async function loadRules(): Promise<NotificationRuleRow[]> {
  const { data, error } = await supabase.from("notification_rules").select("id,name,event_type,conditions,recipient_rules,channel_templates,delay_minutes,cooldown_minutes,max_attempts,backoff_minutes,priority,is_active,lifecycle").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as NotificationRuleRow[];
}

export async function saveRule(input: RuleDraft): Promise<string> {
  const { data, error } = await supabase.rpc("save_notification_rule", {
    p_rule_id: input.id as string,
    p_name: input.name,
    p_event_type: input.eventType,
    p_conditions: input.conditions.map((condition) => ({ ...condition })) as Json,
    p_recipient_rules: input.recipients.map((recipient) => ({ type: recipient.type, ...(recipient.userIds ? { user_ids: [...recipient.userIds] } : {}), ...(recipient.role ? { role: recipient.role } : {}) })) as Json,
    p_channel_templates: { ...input.channelTemplates },
    p_delay_minutes: input.delayMinutes,
    p_cooldown_minutes: input.cooldownMinutes,
    p_max_attempts: input.maxAttempts,
    p_backoff_minutes: input.backoffMinutes,
    p_priority: input.priority,
    p_is_enabled: input.enabled,
  });
  if (error) throw error;
  return data as string;
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_notification_rule_enabled", { p_rule_id: id, p_enabled: enabled });
  if (error) throw error;
}

export async function archiveRule(id: string): Promise<void> {
  const { error } = await supabase.rpc("archive_notification_rule", { p_rule_id: id });
  if (error) throw error;
}

export async function loadProviders(): Promise<ProviderAvailability[]> {
  const { data, error } = await supabase.rpc("get_notification_provider_availability");
  if (error) throw error;
  return (data ?? []) as ProviderAvailability[];
}

export async function loadDeliveryLogs(filters: { state?: string; channel?: string; eventType?: string; search?: string }): Promise<DeliveryLog[]> {
  const { data, error } = await supabase.rpc("list_notification_delivery_logs", {
    p_state: filters.state || null,
    p_channel: filters.channel || null,
    p_event_type: filters.eventType || null,
    p_search: filters.search || null,
    p_from: null,
    p_to: null,
    p_limit: 100,
    p_offset: 0,
  } as never);
  if (error) throw error;
  return (data ?? []) as DeliveryLog[];
}

export async function retryDelivery(id: string): Promise<void> {
  const { error } = await supabase.rpc("retry_notification_delivery", { p_delivery_id: id });
  if (error) throw error;
}

export async function loadActiveRecipientProfiles(): Promise<Array<{ id: string; employee_name: string; user_role: string }>> {
  const { data, error } = await supabase.from("user_profiles").select("id,employee_name,user_role").eq("is_login_enabled", true).not("working_status", "in", "(inactive,resigned)").order("employee_name");
  if (error) throw error;
  return data ?? [];
}
