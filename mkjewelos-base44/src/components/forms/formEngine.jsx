const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

/**
 * JewelOS Universal Form Engine
 * 
 * JSON Storage Structure:
 * FormTemplate.fields[] → array of field definitions
 * FormSubmission.data → { [field.id]: rawValue }
 * FormSubmission.data_display → { [field.label]: humanReadableValue }
 * 
 * Linking Architecture:
 * FormTemplate.linked_entities[] → [{ entity_type, trigger, auto_populate_fields }]
 * On submission: check linked_entities and auto-create/update related records
 * 
 * Validation Logic:
 * 1. Required field check
 * 2. Type-specific validation (min/max, pattern, etc.)
 * 3. Conditional field resolution
 * 4. Multi-tenant isolation (tenant_id injected server-side)
 * 5. Role-based access (access_roles checked against userProfile.role_level)
 */

// ─── RBAC Guard ───────────────────────────────────────────────────────────────
export function canAccessForm(form, userProfile) {
  if (!userProfile) return false;
  const privileged = ['super_admin', 'tenant_admin', 'branch_manager'];
  if (privileged.includes(userProfile.role_level)) return true;
  if (!form.access_roles?.length) return true; // open to all if no restriction
  return form.access_roles.includes(userProfile.role_level);
}

// ─── Conditional Field Visibility ────────────────────────────────────────────
export function isFieldVisible(field, formValues) {
  if (!field.conditional?.show_if_field) return true;
  const { show_if_field, show_if_value, operator = 'equals' } = field.conditional;
  const watchedValue = String(formValues[show_if_field] || '');

  switch (operator) {
    case 'equals': return watchedValue === show_if_value;
    case 'not_equals': return watchedValue !== show_if_value;
    case 'contains': return watchedValue.includes(show_if_value);
    case 'not_empty': return watchedValue.trim().length > 0;
    default: return true;
  }
}

// ─── Field Validation ─────────────────────────────────────────────────────────
export function validateField(field, value, formValues) {
  if (!isFieldVisible(field, formValues)) return null; // skip hidden fields

  const isEmpty = value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);

  if (field.required && isEmpty) {
    return `${field.label} is required`;
  }
  if (isEmpty) return null;

  const v = field.validation || {};

  switch (field.type) {
    case 'text':
    case 'textarea':
      if (v.minLength && String(value).length < v.minLength)
        return `${field.label} must be at least ${v.minLength} characters`;
      if (v.maxLength && String(value).length > v.maxLength)
        return `${field.label} must be at most ${v.maxLength} characters`;
      if (v.pattern && !new RegExp(v.pattern).test(String(value)))
        return v.pattern_message || `${field.label} format is invalid`;
      break;

    case 'number':
    case 'currency':
    case 'rating':
      const num = parseFloat(value);
      if (isNaN(num)) return `${field.label} must be a valid number`;
      if (v.min !== undefined && num < v.min) return `${field.label} must be ≥ ${v.min}`;
      if (v.max !== undefined && num > v.max) return `${field.label} must be ≤ ${v.max}`;
      break;

    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))
        return `${field.label} must be a valid email`;
      break;

    case 'phone':
      if (!/^[\d\s\+\-\(\)]{7,15}$/.test(String(value)))
        return `${field.label} must be a valid phone number`;
      break;

    case 'date':
    case 'datetime':
      if (v.min && new Date(value) < new Date(v.min))
        return `${field.label} must be after ${v.min}`;
      if (v.max && new Date(value) > new Date(v.max))
        return `${field.label} must be before ${v.max}`;
      break;
  }

  return null;
}

// ─── Full Form Validation ─────────────────────────────────────────────────────
export function validateForm(fields, formValues) {
  const errors = {};
  for (const field of fields) {
    if (['divider', 'heading'].includes(field.type)) continue;
    const error = validateField(field, formValues[field.id], formValues);
    if (error) errors[field.id] = error;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// ─── Build Submission Payload ─────────────────────────────────────────────────
export function buildSubmissionPayload({
  form,
  formValues,
  userProfile,
  user,
  linkedEntityType = null,
  linkedEntityId = null,
  linkedEntityName = null,
  startTime = null,
}) {
  const data = {};
  const data_display = {};

  for (const field of (form.fields || [])) {
    if (['divider', 'heading'].includes(field.type)) continue;
    if (!isFieldVisible(field, formValues)) continue;
    const raw = formValues[field.id];
    if (raw !== undefined && raw !== null && raw !== '') {
      data[field.id] = raw;
      data_display[field.label] = formatDisplayValue(field, raw);
    }
  }

  return {
    tenant_id: userProfile?.tenant_id || '',
    branch_id: userProfile?.branch_id || '',
    department_id: userProfile?.department_id || '',
    form_template_id: form.id,
    form_name: form.name,
    form_version: form.version || 1,
    submitted_by: user?.id || '',
    submitter_name: user?.full_name || user?.email || '',
    data,
    data_display,
    linked_entity_type: linkedEntityType,
    linked_entity_id: linkedEntityId,
    linked_entity_name: linkedEntityName,
    status: 'submitted',
    submission_duration_seconds: startTime ? Math.round((Date.now() - startTime) / 1000) : null,
  };
}

export function formatDisplayValue(field, value) {
  if (value === undefined || value === null) return '';
  switch (field.type) {
    case 'checkbox': return value ? 'Yes' : 'No';
    case 'currency': return `₹${parseFloat(value).toLocaleString('en-IN')}`;
    case 'multiselect': return Array.isArray(value) ? value.join(', ') : value;
    case 'date': return value ? new Date(value).toLocaleDateString('en-IN') : '';
    case 'rating': return `${value}/5`;
    default: return String(value);
  }
}

// ─── Post-Submission Side Effects ─────────────────────────────────────────────
export async function handleSubmissionSideEffects(form, submission, userProfile) {
  if (!form.linked_entities?.length) return;

  for (const link of form.linked_entities) {
    if (link.trigger !== 'manual') continue; // only manual triggers for now

    if (link.entity_type === 'TaskInstance') {
      // Auto-create a follow-up task from submission
      await db.entities.TaskInstance.create({
        tenant_id: userProfile.tenant_id,
        branch_id: userProfile.branch_id,
        title: `Follow-up: ${form.name}`,
        description: `Auto-created from form submission`,
        due_date_only: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 86400000).toISOString(),
        assigned_to: userProfile.user_id,
        status: 'pending',
        priority: 'medium',
        source: 'recurring',
        related_entity: 'FormSubmission',
        related_entity_id: submission.id,
      });
    }
  }
}

// ─── Template Presets ─────────────────────────────────────────────────────────
export const FORM_PRESETS = {
  crm_follow_up: {
    name: 'CRM Follow-up',
    category: 'crm',
    fields: [
      { id: 'f1', type: 'text', label: 'Customer Name', required: true, order: 0, width: 'half' },
      { id: 'f2', type: 'phone', label: 'Contact Number', required: true, order: 1, width: 'half' },
      { id: 'f3', type: 'select', label: 'Follow-up Type', required: true, order: 2, width: 'half', options: ['Call', 'Visit', 'WhatsApp', 'Email'] },
      { id: 'f4', type: 'select', label: 'Outcome', required: true, order: 3, width: 'half', options: ['Interested', 'Not Interested', 'Callback', 'Purchased', 'Pending'] },
      { id: 'f5', type: 'date', label: 'Next Follow-up Date', required: false, order: 4, width: 'half' },
      { id: 'f6', type: 'textarea', label: 'Notes', required: false, order: 5, width: 'full' },
    ]
  },
  repair_job: {
    name: 'Repair Job Card',
    category: 'pms_stage',
    fields: [
      { id: 'f1', type: 'text', label: 'Customer Name', required: true, order: 0, width: 'half' },
      { id: 'f2', type: 'phone', label: 'Phone', required: true, order: 1, width: 'half' },
      { id: 'f3', type: 'text', label: 'Item Description', required: true, order: 2, width: 'full' },
      { id: 'f4', type: 'select', label: 'Metal Type', required: true, order: 3, width: 'half', options: ['Gold 22K', 'Gold 18K', 'Silver', 'Platinum', 'Other'] },
      { id: 'f5', type: 'number', label: 'Estimated Weight (grams)', required: false, order: 4, width: 'half' },
      { id: 'f6', type: 'select', label: 'Repair Type', required: true, order: 5, width: 'half', options: ['Sizing', 'Polishing', 'Stone Setting', 'Welding', 'Rhodium', 'Custom'] },
      { id: 'f7', type: 'currency', label: 'Estimate (₹)', required: false, order: 6, width: 'half' },
      { id: 'f8', type: 'date', label: 'Delivery Date', required: true, order: 7, width: 'half' },
      { id: 'f9', type: 'textarea', label: 'Special Instructions', required: false, order: 8, width: 'full' },
    ]
  },
  daily_audit: {
    name: 'Daily Branch Audit',
    category: 'audit',
    fields: [
      { id: 'f1', type: 'heading', label: 'Opening Checks', order: 0, width: 'full' },
      { id: 'f2', type: 'checkbox', label: 'Security checked', required: true, order: 1, width: 'half' },
      { id: 'f3', type: 'checkbox', label: 'Cash drawer verified', required: true, order: 2, width: 'half' },
      { id: 'f4', type: 'checkbox', label: 'Display cleaned', required: false, order: 3, width: 'half' },
      { id: 'f5', type: 'number', label: 'Opening Cash (₹)', required: true, order: 4, width: 'half' },
      { id: 'f6', type: 'divider', label: '', order: 5, width: 'full' },
      { id: 'f7', type: 'heading', label: 'Staff Attendance', order: 6, width: 'full' },
      { id: 'f8', type: 'number', label: 'Staff Present', required: true, order: 7, width: 'half' },
      { id: 'f9', type: 'textarea', label: 'Remarks', required: false, order: 8, width: 'full' },
    ]
  }
};