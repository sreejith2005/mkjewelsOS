const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

/**
 * JewelOS Analytics Engine
 *
 * Architecture:
 *   Raw Entities → Aggregation Queries → KPI Computation → Cache → Dashboard API
 *
 * Caching Strategy:
 *   - DashboardCache entity stores pre-computed payloads keyed by (user_id|branch_id, period, date_range)
 *   - Cache TTL: daily=5min, weekly=30min, monthly=2hr
 *   - Invalidated on relevant entity updates (tasks, customers, workflows)
 *   - Daily cron aggregation via startAnalyticsCron() saves PerformanceMetric records
 *
 * Formulas:
 *   conversion_rate        = sales_conversions / clients_attended × 100
 *   crm_data_completeness  = clients_with_all_required_fields / total_clients × 100
 *   task_completion_rate   = tasks_completed / (tasks_completed + tasks_overdue + tasks_pending) × 100
 *   fms_efficiency         = workflow_completed / (workflow_completed + workflow_active) × 100
 *   staff_discipline_score = task_completion_rate × 0.4 + followup_completion_rate × 0.3 + (1 - sla_breach_rate) × 0.3 × 100
 */

import { format, subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

// ─── DATE RANGE HELPERS ───────────────────────────────────────────────────────
export function getDateRange(period, customFrom = null, customTo = null) {
  const today = new Date();
  switch (period) {
    case 'today':
      return { from: format(today, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
    case 'week':
      return { from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd') };
    case 'month':
      return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: format(endOfMonth(today), 'yyyy-MM-dd') };
    case 'last7':
      return { from: format(subDays(today, 6), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
    case 'last30':
      return { from: format(subDays(today, 29), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
    case 'custom':
      return { from: customFrom, to: customTo };
    default:
      return { from: format(today, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
  }
}

// ─── CACHE MANAGER ────────────────────────────────────────────────────────────
const TTL = { today: 5, week: 30, month: 120, last7: 15, last30: 60, custom: 30 }; // minutes

function buildCacheKey(roleContext, userId, branchId, period, dateFrom, dateTo) {
  return `${roleContext}_${period}_${dateFrom}_${dateTo}_${userId || branchId || 'all'}`;
}

async function getCache(cacheKey) {
  const hits = await db.entities.DashboardCache.filter({ cache_key: cacheKey, is_valid: true });
  if (!hits.length) return null;
  const hit = hits[0];
  if (new Date(hit.expires_at) < new Date()) {
    await db.entities.DashboardCache.update(hit.id, { is_valid: false });
    return null;
  }
  return hit.payload;
}

async function setCache(cacheKey, payload, roleContext, period, userId, branchId, tenantId, dateFrom, dateTo) {
  const ttlMs = (TTL[period] || 15) * 60 * 1000;
  const expires_at = new Date(Date.now() + ttlMs).toISOString();

  const existing = await db.entities.DashboardCache.filter({ cache_key: cacheKey });
  if (existing.length) {
    await db.entities.DashboardCache.update(existing[0].id, { payload, computed_at: new Date().toISOString(), expires_at, is_valid: true });
  } else {
    await db.entities.DashboardCache.create({
      tenant_id: tenantId,
      branch_id: branchId,
      user_id: userId,
      cache_key: cacheKey,
      role_context: roleContext,
      period,
      date_from: dateFrom,
      date_to: dateTo,
      payload,
      computed_at: new Date().toISOString(),
      expires_at,
      is_valid: true,
    });
  }
}

// ─── DATE FILTER HELPER ───────────────────────────────────────────────────────
function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = dateStr.substring(0, 10);
  return d >= from && d <= to;
}

// ─── SALESPERSON DASHBOARD ───────────────────────────────────────────────────
export async function getSalespersonDashboard(userProfile, period = 'today', customFrom = null, customTo = null) {
  const { from, to } = getDateRange(period, customFrom, customTo);
  const cacheKey = buildCacheKey('salesperson', userProfile.user_id, userProfile.branch_id, period, from, to);

  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, _cached: true };

  const isOwner = !userProfile.tenant_id;
  const [customers, interactions, tasks, taskInstances] = await Promise.all([
    isOwner ? db.entities.Customer.list() : db.entities.Customer.filter({ tenant_id: userProfile.tenant_id, assigned_to: userProfile.user_id }),
    isOwner ? db.entities.CustomerInteraction.list() : db.entities.CustomerInteraction.filter({ tenant_id: userProfile.tenant_id, user_id: userProfile.user_id }),
    isOwner ? db.entities.Task.list() : db.entities.Task.filter({ tenant_id: userProfile.tenant_id, assigned_to: userProfile.user_id }),
    isOwner ? db.entities.TaskInstance.list() : db.entities.TaskInstance.filter({ tenant_id: userProfile.tenant_id, assigned_to: userProfile.user_id }),
  ]);

  // Filter to date range
  const rangeCustomers = customers.filter(c => inRange(c.created_date, from, to));
  const rangeInteractions = interactions.filter(i => inRange(i.created_date, from, to));
  const rangeFollowups = interactions.filter(i => inRange(i.follow_up_date, from, to));
  const rangeTasks = [...tasks, ...taskInstances].filter(t => inRange(t.created_date, from, to));

  const clients_attended = rangeCustomers.length;
  const calls_made = rangeInteractions.filter(i => ['call', 'whatsapp', 'sms'].includes(i.type)).length;
  const followups_done = rangeFollowups.filter(i => i.outcome !== 'pending').length;
  const sales_conversions = rangeInteractions.filter(i => i.outcome === 'positive').length;
  const referrals_collected = customers.filter(c => c.source === 'referral' && inRange(c.created_date, from, to)).length;
  const reviews_collected = rangeInteractions.filter(i => i.type === 'meeting' && i.outcome === 'positive').length;
  const conversion_rate = clients_attended > 0 ? ((sales_conversions / clients_attended) * 100).toFixed(1) : 0;

  // Daily chart data for sparkline
  const dayMap = {};
  rangeInteractions.forEach(i => {
    const d = (i.created_date || '').substring(0, 10);
    if (!dayMap[d]) dayMap[d] = { date: d, clients: 0, sales: 0, calls: 0 };
    dayMap[d].clients++;
    if (i.outcome === 'positive') dayMap[d].sales++;
    if (['call', 'whatsapp', 'sms'].includes(i.type)) dayMap[d].calls++;
  });
  const chart_data = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  // Task summary
  const tasks_completed = [...tasks, ...taskInstances].filter(t => t.status === 'completed').length;
  const tasks_pending = [...tasks, ...taskInstances].filter(t => ['pending', 'in_progress'].includes(t.status)).length;

  // Recent interactions table
  const recent_interactions = rangeInteractions
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
    .slice(0, 10)
    .map(i => ({
      id: i.id,
      type: i.type,
      subject: i.subject,
      outcome: i.outcome,
      date: i.created_date?.substring(0, 10),
      follow_up_date: i.follow_up_date,
    }));

  const payload = {
    role: 'salesperson',
    period, from, to,
    kpis: {
      clients_attended,
      sales_conversions,
      calls_made,
      followups_done,
      referrals_collected,
      reviews_collected,
      conversion_rate: parseFloat(conversion_rate),
      tasks_completed,
      tasks_pending,
    },
    chart_data,
    recent_interactions,
    total_customers: customers.length,
  };

  await setCache(cacheKey, payload, 'salesperson', period, userProfile.user_id, userProfile.branch_id, userProfile.tenant_id, from, to);
  return payload;
}

// ─── CRM ROLE DASHBOARD ───────────────────────────────────────────────────────
export async function getCRMDashboard(userProfile, period = 'today', customFrom = null, customTo = null) {
  const { from, to } = getDateRange(period, customFrom, customTo);
  const cacheKey = buildCacheKey('crm', userProfile.user_id, userProfile.branch_id, period, from, to);

  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, _cached: true };

  const isOwner = !userProfile.tenant_id;
  const [customers, interactions] = await Promise.all([
    isOwner ? db.entities.Customer.list() : db.entities.Customer.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
    isOwner ? db.entities.CustomerInteraction.list() : db.entities.CustomerInteraction.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
  ]);

  const total_clients = customers.length;

  // CRM Data Completeness: clients with required fields (first_name, phone, email, date_of_birth)
  const required_fields = ['first_name', 'phone', 'email', 'date_of_birth'];
  const complete = customers.filter(c => required_fields.every(f => c[f]));
  const crm_data_completeness = total_clients > 0 ? ((complete.length / total_clients) * 100).toFixed(1) : 0;

  // Segmentation
  const by_type = {};
  const by_source = {};
  customers.forEach(c => {
    by_type[c.customer_type] = (by_type[c.customer_type] || 0) + 1;
    by_source[c.source] = (by_source[c.source] || 0) + 1;
  });

  // Interaction health
  const rangeInteractions = interactions.filter(i => inRange(i.created_date, from, to));
  const overdue_followups = interactions.filter(i =>
    i.follow_up_date && i.follow_up_date < from && i.outcome === 'pending'
  ).length;
  const due_today_followups = interactions.filter(i =>
    i.follow_up_date === format(new Date(), 'yyyy-MM-dd') && i.outcome === 'pending'
  ).length;

  const total_interactions = rangeInteractions.length;
  const positive_outcomes = rangeInteractions.filter(i => i.outcome === 'positive').length;
  const followup_completion_rate = total_interactions > 0
    ? ((rangeInteractions.filter(i => i.outcome !== 'pending').length / total_interactions) * 100).toFixed(1)
    : 0;

  // Missing fields breakdown
  const missing_breakdown = {};
  required_fields.forEach(f => {
    missing_breakdown[f] = customers.filter(c => !c[f]).length;
  });

  // Acquisition trend
  const acquisitionMap = {};
  customers.filter(c => inRange(c.created_date, from, to)).forEach(c => {
    const d = c.created_date.substring(0, 10);
    acquisitionMap[d] = (acquisitionMap[d] || 0) + 1;
  });
  const acquisition_chart = Object.entries(acquisitionMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // Top follow-up due customers
  const due_customers = interactions
    .filter(i => i.follow_up_date && i.follow_up_date <= to && i.outcome === 'pending')
    .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))
    .slice(0, 10);

  const payload = {
    role: 'crm',
    period, from, to,
    kpis: {
      total_clients,
      crm_data_completeness: parseFloat(crm_data_completeness),
      complete_profiles: complete.length,
      incomplete_profiles: total_clients - complete.length,
      total_interactions,
      positive_outcomes,
      followup_completion_rate: parseFloat(followup_completion_rate),
      overdue_followups,
      due_today_followups,
    },
    by_type,
    by_source,
    missing_breakdown,
    acquisition_chart,
    due_customers,
  };

  await setCache(cacheKey, payload, 'crm', period, userProfile.user_id, userProfile.branch_id, userProfile.tenant_id, from, to);
  return payload;
}

// ─── MANAGER DASHBOARD ────────────────────────────────────────────────────────
export async function getManagerDashboard(userProfile, period = 'today', customFrom = null, customTo = null) {
  const { from, to } = getDateRange(period, customFrom, customTo);
  const cacheKey = buildCacheKey('manager', null, userProfile.branch_id, period, from, to);

  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, _cached: true };

  const isOwner = !userProfile.tenant_id;
  const [
    allTasks, allTaskInstances, allWorkflows, allWorkflowInstances,
    allCustomers, allInteractions, allProfiles, allFormSubmissions
  ] = await Promise.all([
    isOwner ? db.entities.Task.list() : db.entities.Task.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
    isOwner ? db.entities.TaskInstance.list() : db.entities.TaskInstance.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
    isOwner ? db.entities.Workflow.list() : db.entities.Workflow.filter({ tenant_id: userProfile.tenant_id }),
    isOwner ? db.entities.WorkflowInstance.list() : db.entities.WorkflowInstance.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
    isOwner ? db.entities.Customer.list() : db.entities.Customer.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
    isOwner ? db.entities.CustomerInteraction.list() : db.entities.CustomerInteraction.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
    isOwner ? db.entities.UserProfile.list() : db.entities.UserProfile.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
    isOwner ? db.entities.FormSubmission.list() : db.entities.FormSubmission.filter({ tenant_id: userProfile.tenant_id, branch_id: userProfile.branch_id }),
  ]);

  const allTasksCombined = [...allTasks, ...allTaskInstances];
  const rangeTasks = allTasksCombined.filter(t => inRange(t.created_date, from, to));
  const rangeWorkflows = allWorkflowInstances.filter(w => inRange(w.created_date, from, to));
  const rangeInteractions = allInteractions.filter(i => inRange(i.created_date, from, to));
  const rangeForms = allFormSubmissions.filter(f => inRange(f.created_date, from, to));

  // Task Performance
  const tasks_completed = allTasksCombined.filter(t => t.status === 'completed').length;
  const tasks_overdue = allTasksCombined.filter(t => t.status === 'overdue' || (t.due_date_only && t.due_date_only < from && t.status !== 'completed')).length;
  const tasks_pending = allTasksCombined.filter(t => ['pending', 'in_progress'].includes(t.status)).length;
  const total_tasks = allTasksCombined.length;
  const task_completion_rate = total_tasks > 0 ? ((tasks_completed / total_tasks) * 100).toFixed(1) : 0;

  // FMS Efficiency
  const wf_completed = allWorkflowInstances.filter(w => w.status === 'completed').length;
  const wf_active = allWorkflowInstances.filter(w => w.status === 'active').length;
  const wf_sla_breached = allWorkflowInstances.filter(w => w.sla_breached).length;
  const fms_efficiency = (wf_completed + wf_active) > 0
    ? ((wf_completed / (wf_completed + wf_active)) * 100).toFixed(1)
    : 0;

  // Staff Discipline Score per user
  const staffScores = {};
  allProfiles.forEach(profile => {
    const userTasks = allTasksCombined.filter(t => t.assigned_to === profile.user_id);
    const userCompleted = userTasks.filter(t => t.status === 'completed').length;
    const userOverdue = userTasks.filter(t => t.sla_breached || t.status === 'overdue').length;
    const userFollowups = allInteractions.filter(i => i.user_id === profile.user_id);
    const userFollowupsDone = userFollowups.filter(i => i.outcome !== 'pending').length;

    const tcr = userTasks.length > 0 ? userCompleted / userTasks.length : 1;
    const fcr = userFollowups.length > 0 ? userFollowupsDone / userFollowups.length : 1;
    const slaBreach = userTasks.length > 0 ? userOverdue / userTasks.length : 0;
    const score = Math.round((tcr * 0.4 + fcr * 0.3 + (1 - slaBreach) * 0.3) * 100);

    staffScores[profile.user_id] = {
      user_id: profile.user_id,
      designation: profile.designation,
      role_level: profile.role_level,
      tasks_total: userTasks.length,
      tasks_completed: userCompleted,
      tasks_overdue: userOverdue,
      followups_done: userFollowupsDone,
      discipline_score: score,
    };
  });

  // Daily task trend chart
  const taskTrend = {};
  rangeTasks.forEach(t => {
    const d = (t.created_date || '').substring(0, 10);
    if (!taskTrend[d]) taskTrend[d] = { date: d, completed: 0, overdue: 0, pending: 0 };
    if (t.status === 'completed') taskTrend[d].completed++;
    else if (t.status === 'overdue') taskTrend[d].overdue++;
    else taskTrend[d].pending++;
  });
  const task_trend_chart = Object.values(taskTrend).sort((a, b) => a.date.localeCompare(b.date));

  // Interaction outcome breakdown
  const outcome_breakdown = { positive: 0, neutral: 0, negative: 0, pending: 0 };
  rangeInteractions.forEach(i => { outcome_breakdown[i.outcome] = (outcome_breakdown[i.outcome] || 0) + 1; });

  // CRM data completeness
  const required_fields = ['first_name', 'phone', 'email', 'date_of_birth'];
  const complete_clients = allCustomers.filter(c => required_fields.every(f => c[f])).length;
  const crm_data_completeness = allCustomers.length > 0
    ? ((complete_clients / allCustomers.length) * 100).toFixed(1)
    : 0;

  const payload = {
    role: 'manager',
    period, from, to,
    kpis: {
      total_staff: allProfiles.length,
      total_clients: allCustomers.length,
      new_clients_period: allCustomers.filter(c => inRange(c.created_date, from, to)).length,
      tasks_completed,
      tasks_overdue,
      tasks_pending,
      task_completion_rate: parseFloat(task_completion_rate),
      wf_completed,
      wf_active,
      wf_sla_breached,
      fms_efficiency: parseFloat(fms_efficiency),
      total_interactions: rangeInteractions.length,
      crm_data_completeness: parseFloat(crm_data_completeness),
      forms_submitted: rangeForms.length,
    },
    staff_scores: Object.values(staffScores).sort((a, b) => b.discipline_score - a.discipline_score),
    task_trend_chart,
    outcome_breakdown,
    workflow_summary: allWorkflows.map(w => ({
      id: w.id,
      name: w.name,
      category: w.category,
      active_instances: allWorkflowInstances.filter(i => i.workflow_id === w.id && i.status === 'active').length,
      completed_instances: allWorkflowInstances.filter(i => i.workflow_id === w.id && i.status === 'completed').length,
    })),
  };

  await setCache(cacheKey, payload, 'manager', period, null, userProfile.branch_id, userProfile.tenant_id, from, to);
  return payload;
}

// ─── ROLE ROUTER ──────────────────────────────────────────────────────────────
export async function getDashboardData(userProfile, period = 'today', customFrom = null, customTo = null) {
  const role = userProfile?.role_level;
  if (['super_admin', 'tenant_admin', 'branch_manager', 'department_head'].includes(role)) {
    return getManagerDashboard(userProfile, period, customFrom, customTo);
  }
  if (role === 'team_lead') {
    return getCRMDashboard(userProfile, period, customFrom, customTo);
  }
  return getSalespersonDashboard(userProfile, period, customFrom, customTo);
}

// ─── DAILY CRON AGGREGATOR ────────────────────────────────────────────────────
/**
 * Run once per day to save PerformanceMetric records for historical trending.
 * Call: startAnalyticsCron(userProfile) on app load (runs on mount, then interval 24h).
 */
export async function aggregateDailyMetrics(userProfile) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const data = await getDashboardData(userProfile, 'today');

  const metricsToSave = [];

  if (data.role === 'salesperson') {
    Object.entries(data.kpis).forEach(([key, value]) => {
      metricsToSave.push({
        tenant_id: userProfile.tenant_id,
        branch_id: userProfile.branch_id,
        user_id: userProfile.user_id,
        role_context: 'staff',
        metric_type: key,
        period: 'daily',
        period_start: today,
        period_end: today,
        value: parseFloat(value) || 0,
        unit: key.includes('rate') ? 'percentage' : 'count',
        source_entity: 'CustomerInteraction,TaskInstance',
        is_cached: false,
      });
    });
  }

  if (data.role === 'manager') {
    Object.entries(data.kpis).forEach(([key, value]) => {
      metricsToSave.push({
        tenant_id: userProfile.tenant_id,
        branch_id: userProfile.branch_id,
        role_context: 'branch_manager',
        metric_type: key,
        period: 'daily',
        period_start: today,
        period_end: today,
        value: parseFloat(value) || 0,
        unit: key.includes('rate') ? 'percentage' : 'count',
        source_entity: 'multiple',
        is_cached: false,
      });
    });
  }

  for (const metric of metricsToSave) {
    await db.entities.PerformanceMetric.create(metric);
  }

  return metricsToSave.length;
}

export function startAnalyticsCron(userProfile) {
  if (!userProfile?.tenant_id) return () => {};

  aggregateDailyMetrics(userProfile).catch(console.warn);

  // Run every 24 hours
  const interval = setInterval(() => aggregateDailyMetrics(userProfile).catch(console.warn), 24 * 60 * 60 * 1000);
  return () => clearInterval(interval);
}

// ─── CHART HELPERS ────────────────────────────────────────────────────────────
export function buildBarChartData(obj, keyLabel = 'name', valueLabel = 'value') {
  return Object.entries(obj || {}).map(([k, v]) => ({ [keyLabel]: k, [valueLabel]: v }));
}

export function buildTrendData(arr, dateKey = 'date') {
  return [...arr].sort((a, b) => String(a[dateKey]).localeCompare(String(b[dateKey])));
}