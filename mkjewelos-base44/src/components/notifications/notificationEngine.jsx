const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

/**
 * JewelOS Notification Engine
 * Architecture: Event → Rule → Template → Provider → Log
 *
 * Provider Abstraction:
 *   All channels implement the same interface:
 *   { send(payload): Promise<{ success, provider_message_id, error }> }
 *
 * Retry Mechanism:
 *   On failure, log is marked failed with next_retry_at = now + retry_interval_minutes
 *   Background job retries up to rule.retry_count times
 *
 * Background Job Architecture:
 *   - notificationEngine.runBackgroundJobs() should be called on app load (polling every 60s)
 *   - Jobs: (1) check rule conditions for scheduled events (OVERDUE, DUE, ANNIVERSARY)
 *            (2) retry failed notifications
 *            (3) resolve cooldown conflicts
 */

// ─── SUPPORTED EVENTS ────────────────────────────────────────────────────────
export const EVENTS = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_OVERDUE: 'TASK_OVERDUE',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_DELEGATED: 'TASK_DELEGATED',
  FOLLOWUP_DUE: 'FOLLOWUP_DUE',
  FOLLOWUP_OVERDUE: 'FOLLOWUP_OVERDUE',
  FMS_STAGE_CHANGED: 'FMS_STAGE_CHANGED',
  FMS_COMPLETED: 'FMS_COMPLETED',
  FMS_SLA_BREACH: 'FMS_SLA_BREACH',
  FORM_SUBMITTED: 'FORM_SUBMITTED',
  FORM_APPROVED: 'FORM_APPROVED',
  FORM_REJECTED: 'FORM_REJECTED',
  CLIENT_WALKIN_CREATED: 'CLIENT_WALKIN_CREATED',
  CLIENT_ANNIVERSARY: 'CLIENT_ANNIVERSARY',
  CLIENT_BIRTHDAY: 'CLIENT_BIRTHDAY',
  SYSTEM_ALERT: 'SYSTEM_ALERT',
  CUSTOM: 'CUSTOM',
};

// ─── TEMPLATE VARIABLE RESOLVER ───────────────────────────────────────────────
/**
 * Resolves {{variable}} placeholders in a template string.
 * @param {string} template - e.g. "Hello {{user_name}}, task {{task_title}} is due {{due_date}}"
 * @param {object} vars - { user_name: 'Rahul', task_title: 'Opening Check', due_date: '24 Feb' }
 * @returns {string} resolved string
 */
export function resolveTemplate(template, vars = {}) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
  });
}

// ─── CONDITION EVALUATOR ─────────────────────────────────────────────────────
/**
 * Evaluates a single rule condition against an event payload.
 * @param {object} condition - { field, operator, value }
 * @param {object} payload - event data
 */
function evaluateCondition(condition, payload) {
  const rawVal = payload[condition.field];
  const condVal = condition.value;

  switch (condition.operator) {
    case 'equals': return String(rawVal) === String(condVal);
    case 'not_equals': return String(rawVal) !== String(condVal);
    case 'contains': return String(rawVal || '').toLowerCase().includes(String(condVal).toLowerCase());
    case 'gt': return parseFloat(rawVal) > parseFloat(condVal);
    case 'gte': return parseFloat(rawVal) >= parseFloat(condVal);
    case 'lt': return parseFloat(rawVal) < parseFloat(condVal);
    case 'lte': return parseFloat(rawVal) <= parseFloat(condVal);
    case 'is_empty': return rawVal === null || rawVal === undefined || rawVal === '';
    case 'is_not_empty': return rawVal !== null && rawVal !== undefined && rawVal !== '';
    case 'is_today': {
      if (!rawVal) return false;
      const today = new Date().toISOString().split('T')[0];
      return String(rawVal).startsWith(today);
    }
    case 'is_past': {
      if (!rawVal) return false;
      return new Date(rawVal) < new Date();
    }
    case 'is_future': {
      if (!rawVal) return false;
      return new Date(rawVal) > new Date();
    }
    default: return false;
  }
}

/**
 * Returns true if ALL conditions of a rule match the payload.
 */
export function ruleMatchesEvent(rule, eventType, payload) {
  if (rule.event_type !== eventType) return false;
  if (!rule.is_active) return false;

  // Cooldown check (client-side best-effort — server should enforce too)
  if (rule.cooldown_hours && rule.last_fired_at) {
    const cooldownMs = rule.cooldown_hours * 60 * 60 * 1000;
    if (Date.now() - new Date(rule.last_fired_at).getTime() < cooldownMs) return false;
  }

  const conditions = rule.conditions || [];
  return conditions.every(c => evaluateCondition(c, payload));
}

// ─── PROVIDER ABSTRACTION ────────────────────────────────────────────────────
/**
 * Provider interface. Each provider must implement:
 *   { canHandle(channel), send(payload) }
 */
const providers = {
  in_app: {
    canHandle: (ch) => ch === 'in_app',
    async send({ recipient_user_id, subject, body, related_entity_type, related_entity_id, tenant_id, branch_id, priority }) {
      // Creates a Notification record — shown in the app's notification bell
      const notif = await db.entities.Notification.create({
        tenant_id,
        branch_id: branch_id || '',
        user_id: recipient_user_id,
        title: subject,
        message: body,
        type: 'system',
        priority: priority || 'normal',
        channel: 'in_app',
        is_read: false,
        related_entity: related_entity_type,
        related_entity_id,
        sent_at: new Date().toISOString(),
        delivery_status: 'delivered',
      });
      return { success: true, provider_message_id: notif.id, provider: 'in_app' };
    }
  },

  email: {
    canHandle: (ch) => ch === 'email',
    async send({ recipient_contact, subject, body }) {
      // Uses Base44's built-in SendEmail integration
      await db.integrations.Core.SendEmail({
        to: recipient_contact,
        subject,
        body,
      });
      return { success: true, provider: 'base44_email', provider_message_id: null };
    }
  },

  sms: {
    canHandle: (ch) => ch === 'sms',
    async send({ recipient_contact, body }) {
      // Placeholder: swap with Twilio/MSG91 when backend functions enabled
      console.warn('[NotifEngine] SMS provider not configured. Would send to:', recipient_contact, '→', body);
      return { success: false, provider: 'sms_stub', error: 'SMS provider not configured' };
    }
  },

  whatsapp: {
    canHandle: (ch) => ch === 'whatsapp',
    async send({ recipient_contact, body }) {
      // Placeholder: swap with WATI/Interakt when backend functions enabled
      console.warn('[NotifEngine] WhatsApp provider not configured. Would send to:', recipient_contact, '→', body);
      return { success: false, provider: 'whatsapp_stub', error: 'WhatsApp provider not configured' };
    }
  },
};

function getProvider(channel) {
  return Object.values(providers).find(p => p.canHandle(channel));
}

// ─── RECIPIENT RESOLVER ───────────────────────────────────────────────────────
/**
 * Resolves who to send to based on rule.recipients + payload context.
 * Returns array of { user_id, contact }
 */
async function resolveRecipients(rule, payload, userProfile) {
  const rec = rule.recipients || {};

  switch (rec.type) {
    case 'assigned_user':
      return [{ user_id: payload.assigned_to || payload.user_id, contact: payload.assignee_email }];

    case 'manager':
    case 'department_head':
    case 'branch_manager': {
      const profiles = await db.entities.UserProfile.filter({
        tenant_id: userProfile?.tenant_id,
        branch_id: userProfile?.branch_id,
        role_level: rec.type === 'branch_manager' ? 'branch_manager' : rec.type === 'department_head' ? 'department_head' : 'team_lead',
      });
      return profiles.map(p => ({ user_id: p.user_id, contact: null }));
    }

    case 'custom_user':
      return (rec.user_ids || []).map(id => ({ user_id: id, contact: null }));

    case 'customer':
      return [{ user_id: null, contact: payload.customer_phone || payload.customer_email }];

    default:
      return [{ user_id: payload.assigned_to || payload.user_id, contact: null }];
  }
}

// ─── CORE FIRE ENGINE ─────────────────────────────────────────────────────────
/**
 * Main entry point. Call this whenever an event occurs.
 *
 * @param {string} eventType - EVENTS.TASK_ASSIGNED etc
 * @param {object} payload - event data (task, customer, workflow, etc.)
 * @param {object} userProfile - current user's profile (for tenant/branch context)
 *
 * Usage:
 *   fireEvent(EVENTS.TASK_ASSIGNED, {
 *     assigned_to: 'user_id',
 *     task_title: 'Open Store',
 *     due_date: '2026-02-24',
 *     user_name: 'Rahul',
 *   }, userProfile);
 */
export async function fireEvent(eventType, payload, userProfile) {
  // Load matching active rules
  const rules = await db.entities.NotificationRule.filter({
    event_type: eventType,
    is_active: true,
    tenant_id: userProfile?.tenant_id,
  });

  for (const rule of rules) {
    if (!ruleMatchesEvent(rule, eventType, payload)) continue;

    // Load template
    let template = null;
    if (rule.template_id) {
      try { template = await db.entities.NotificationTemplate.filter({ id: rule.template_id }); template = template[0]; } catch (_) {}
    }

    // Resolve recipients
    const recipients = await resolveRecipients(rule, payload, userProfile);

    for (const recipient of recipients) {
      for (const channel of (rule.channels || [])) {
        const subject = resolveTemplate(template?.subject || defaultSubject(eventType), payload);
        const body = resolveTemplate(template?.body || defaultBody(eventType), payload);

        // Create log entry (queued)
        const log = await db.entities.NotificationLog.create({
          tenant_id: userProfile?.tenant_id || '',
          branch_id: userProfile?.branch_id || '',
          rule_id: rule.id,
          rule_name: rule.name,
          template_id: template?.id,
          event_type: eventType,
          channel,
          recipient_user_id: recipient.user_id,
          recipient_contact: recipient.contact,
          subject,
          body,
          variables_used: payload,
          status: 'queued',
          retry_count: 0,
          related_entity_type: payload.entity_type,
          related_entity_id: payload.entity_id,
        });

        // Attempt send (with optional delay)
        if ((rule.delay_minutes || 0) === 0) {
          await sendNotification(log, rule);
        }
        // Delayed sends would be picked up by background job runner
      }
    }

    // Update rule fire stats
    await db.entities.NotificationRule.update(rule.id, {
      fire_count: (rule.fire_count || 0) + 1,
      last_fired_at: new Date().toISOString(),
    });
  }
}

// ─── SEND A SINGLE NOTIFICATION LOG ──────────────────────────────────────────
export async function sendNotification(log, rule = null) {
  const provider = getProvider(log.channel);
  if (!provider) {
    await db.entities.NotificationLog.update(log.id, { status: 'failed', error_message: 'No provider for channel: ' + log.channel });
    return;
  }

  await db.entities.NotificationLog.update(log.id, { status: 'sending' });

  const result = await provider.send({
    recipient_user_id: log.recipient_user_id,
    recipient_contact: log.recipient_contact,
    subject: log.subject,
    body: log.body,
    related_entity_type: log.related_entity_type,
    related_entity_id: log.related_entity_id,
    tenant_id: log.tenant_id,
    branch_id: log.branch_id,
    priority: rule?.priority,
  });

  if (result.success) {
    await db.entities.NotificationLog.update(log.id, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider: result.provider,
      provider_message_id: result.provider_message_id,
    });
  } else {
    const retries = (log.retry_count || 0) + 1;
    const maxRetries = rule?.retry_count ?? 3;
    const retryInterval = rule?.retry_interval_minutes ?? 30;

    await db.entities.NotificationLog.update(log.id, {
      status: retries >= maxRetries ? 'failed' : 'queued',
      error_message: result.error,
      retry_count: retries,
      next_retry_at: retries < maxRetries
        ? new Date(Date.now() + retryInterval * 60 * 1000).toISOString()
        : null,
      provider: result.provider,
    });
  }
}

// ─── BACKGROUND JOB RUNNER ────────────────────────────────────────────────────
/**
 * Call this on app load. Polls every 60s.
 * Jobs:
 *   1. Retry failed/queued notifications where next_retry_at <= now
 *   2. Check date-based events (FOLLOWUP_DUE, TASK_OVERDUE, etc.)
 */
export function startBackgroundJobs(userProfile) {
  if (!userProfile?.tenant_id) return () => {};

  const run = async () => {
    await retryFailedNotifications();
    await checkScheduledEvents(userProfile);
  };

  run(); // immediate first run
  const interval = setInterval(run, 60 * 1000);
  return () => clearInterval(interval);
}

async function retryFailedNotifications() {
  const now = new Date().toISOString();
  const pending = await db.entities.NotificationLog.filter({ status: 'queued' });
  for (const log of pending) {
    if (!log.next_retry_at || log.next_retry_at <= now) {
      const rules = log.rule_id
        ? await db.entities.NotificationRule.filter({ id: log.rule_id })
        : [null];
      await sendNotification(log, rules[0] || null);
    }
  }
}

async function checkScheduledEvents(userProfile) {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  // FOLLOWUP_DUE: followup_date <= today
  const followups = await db.entities.CustomerInteraction.filter({
    tenant_id: userProfile.tenant_id,
    branch_id: userProfile.branch_id,
  });
  for (const f of followups) {
    if (f.follow_up_date && f.follow_up_date <= today) {
      await fireEvent(EVENTS.FOLLOWUP_DUE, {
        entity_type: 'CustomerInteraction',
        entity_id: f.id,
        user_id: f.user_id,
        assigned_to: f.user_id,
        follow_up_date: f.follow_up_date,
        customer_id: f.customer_id,
      }, userProfile);
    }
  }

  // TASK_OVERDUE: due_date_only < today AND status != completed
  const tasks = await db.entities.TaskInstance.filter({
    tenant_id: userProfile.tenant_id,
    branch_id: userProfile.branch_id,
  });
  for (const t of tasks) {
    if (t.due_date_only < today && !['completed', 'skipped'].includes(t.status)) {
      await fireEvent(EVENTS.TASK_OVERDUE, {
        entity_type: 'TaskInstance',
        entity_id: t.id,
        assigned_to: t.assigned_to,
        task_title: t.title,
        due_date: t.due_date_only,
        priority: t.priority,
      }, userProfile);
    }
  }
}

// ─── DEFAULT TEMPLATES (FALLBACK) ─────────────────────────────────────────────
export const EVENT_META = {
  TASK_ASSIGNED: { label: 'Task Assigned', icon: '📋', variables: ['user_name', 'task_title', 'due_date', 'priority'] },
  TASK_OVERDUE: { label: 'Task Overdue', icon: '⏰', variables: ['user_name', 'task_title', 'due_date'] },
  TASK_COMPLETED: { label: 'Task Completed', icon: '✅', variables: ['user_name', 'task_title', 'completed_at'] },
  TASK_DELEGATED: { label: 'Task Delegated', icon: '🔁', variables: ['user_name', 'task_title', 'delegated_to', 'reason'] },
  FOLLOWUP_DUE: { label: 'Follow-up Due', icon: '📞', variables: ['user_name', 'client_name', 'follow_up_date', 'notes'] },
  FOLLOWUP_OVERDUE: { label: 'Follow-up Overdue', icon: '🔴', variables: ['user_name', 'client_name', 'follow_up_date'] },
  FMS_STAGE_CHANGED: { label: 'Workflow Stage Changed', icon: '🔄', variables: ['user_name', 'workflow_name', 'stage_name', 'reference'] },
  FMS_COMPLETED: { label: 'Workflow Completed', icon: '🏁', variables: ['user_name', 'workflow_name', 'reference', 'completed_at'] },
  FMS_SLA_BREACH: { label: 'SLA Breached', icon: '🚨', variables: ['workflow_name', 'stage_name', 'reference', 'sla_hours'] },
  FORM_SUBMITTED: { label: 'Form Submitted', icon: '📝', variables: ['user_name', 'form_name', 'submitted_at'] },
  FORM_APPROVED: { label: 'Form Approved', icon: '✔️', variables: ['user_name', 'form_name', 'reviewed_by'] },
  FORM_REJECTED: { label: 'Form Rejected', icon: '❌', variables: ['user_name', 'form_name', 'review_notes'] },
  CLIENT_WALKIN_CREATED: { label: 'New Walk-in Client', icon: '🚶', variables: ['client_name', 'phone', 'branch', 'created_by'] },
  CLIENT_ANNIVERSARY: { label: 'Client Anniversary', icon: '💍', variables: ['client_name', 'phone', 'anniversary_date', 'years'] },
  CLIENT_BIRTHDAY: { label: 'Client Birthday', icon: '🎂', variables: ['client_name', 'phone'] },
};

function defaultSubject(eventType) {
  return EVENT_META[eventType]?.label || eventType;
}

function defaultBody(eventType) {
  const defaults = {
    TASK_ASSIGNED: 'Hi {{user_name}}, you have been assigned a new task: {{task_title}}. Due: {{due_date}}.',
    TASK_OVERDUE: '⏰ Task OVERDUE: {{task_title}} was due on {{due_date}}. Please complete it immediately.',
    TASK_COMPLETED: '✅ Task "{{task_title}}" was completed by {{user_name}} at {{completed_at}}.',
    TASK_DELEGATED: '{{user_name}}, task "{{task_title}}" has been delegated to {{delegated_to}}. Reason: {{reason}}.',
    FOLLOWUP_DUE: '📞 Hi {{user_name}}, follow-up with {{client_name}} is due today ({{follow_up_date}}).',
    FOLLOWUP_OVERDUE: '🔴 Overdue follow-up with {{client_name}} was due on {{follow_up_date}}.',
    FMS_STAGE_CHANGED: '🔄 Workflow "{{workflow_name}}" moved to stage "{{stage_name}}" (Ref: {{reference}}).',
    FMS_SLA_BREACH: '🚨 SLA breached on "{{workflow_name}}" at stage "{{stage_name}}" (Ref: {{reference}}, SLA: {{sla_hours}}h).',
    FORM_SUBMITTED: '📝 {{user_name}} submitted form "{{form_name}}" on {{submitted_at}}.',
    CLIENT_WALKIN_CREATED: '🚶 New walk-in: {{client_name}} ({{phone}}) at {{branch}}. Added by {{created_by}}.',
    CLIENT_ANNIVERSARY: '💍 Anniversary reminder: {{client_name}} ({{phone}}) — {{anniversary_date}}. Great time to reach out!',
    CLIENT_BIRTHDAY: '🎂 Birthday today: {{client_name}} ({{phone}}). Send wishes!',
  };
  return defaults[eventType] || '{{message}}';
}