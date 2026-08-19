const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };


import { format, isPast, getDay, getDate, getMonth } from 'date-fns';

export function shouldRunToday(recurringTask) {
  const today = new Date();
  const dayOfWeek = getDay(today);
  const dayOfMonth = getDate(today);
  const monthOfYear = getMonth(today);

  switch (recurringTask.recurrence_type) {
    case 'daily':
      return true;
    case 'weekly':
      if (!recurringTask.recurrence_days?.length) return true;
      return recurringTask.recurrence_days.includes(dayOfWeek);
    case 'monthly':
      if (!recurringTask.recurrence_days?.length) return dayOfMonth === 1;
      return recurringTask.recurrence_days.includes(dayOfMonth);
    case 'yearly':
      if (!recurringTask.recurrence_days?.length) return false;
      return recurringTask.recurrence_days[0] === monthOfYear &&
             recurringTask.recurrence_days[1] === dayOfMonth;
    default:
      return false;
  }
}

export function buildChecklist(checklistTemplate) {
  if (!checklistTemplate?.length) return [];
  return checklistTemplate.map(item => ({
    ...item,
    completed: false,
    completed_at: null,
    completed_by: null,
  }));
}

export function calcChecklistPct(checklist) {
  if (!checklist?.length) return { pct: 100, allRequiredDone: true };
  const total = checklist.length;
  const completed = checklist.filter(c => c.completed).length;
  const required = checklist.filter(c => c.required);
  const requiredDone = required.length === 0 ? true : required.every(c => c.completed);
  return {
    pct: Math.round((completed / total) * 100),
    allRequiredDone: requiredDone,
  };
}

export async function generateTodayInstances(userProfile) {
  if (!userProfile?.tenant_id) return [];
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const [recurringTasks, existing] = await Promise.all([
    db.entities.RecurringTask.filter({ tenant_id: userProfile.tenant_id, is_active: true }),
    db.entities.TaskInstance.filter({ tenant_id: userProfile.tenant_id, due_date_only: todayStr }),
  ]);

  const existingIds = new Set(existing.map(i => i.recurring_task_id).filter(Boolean));
  const toCreate = [];

  for (const rt of recurringTasks) {
    if (!shouldRunToday(rt)) continue;
    if (existingIds.has(rt.id)) continue;

    const dueDateTime = new Date();
    if (rt.recurrence_time) {
      const [h, m] = rt.recurrence_time.split(':').map(Number);
      dueDateTime.setHours(h, m, 0, 0);
    } else {
      dueDateTime.setHours(23, 59, 0, 0);
    }

    toCreate.push({
      tenant_id: rt.tenant_id,
      branch_id: rt.branch_id,
      department_id: rt.department_id,
      recurring_task_id: rt.id,
      title: rt.title,
      description: rt.description,
      category: rt.category,
      priority: rt.priority,
      recurrence_type: rt.recurrence_type,
      due_date: dueDateTime.toISOString(),
      due_date_only: todayStr,
      assigned_to: rt.assigned_to,
      assigned_by: rt.created_by,
      is_delegated: false,
      status: 'pending',
      checklist: buildChecklist(rt.checklist),
      checklist_completion_pct: 0,
      all_required_done: !rt.checklist?.some(c => c.required),
      source: 'recurring',
    });
  }

  if (toCreate.length > 0) {
    await db.entities.TaskInstance.bulkCreate(toCreate);
  }
  return toCreate;
}

export function filterTasksByRole(tasks, userProfile) {
  if (!userProfile) return [];
  const role = userProfile.role_level;
  if (['super_admin', 'tenant_admin', 'branch_manager'].includes(role)) return tasks;
  if (['department_head', 'team_lead'].includes(role)) {
    return tasks.filter(t =>
      t.department_id === userProfile.department_id ||
      t.assigned_to === userProfile.user_id
    );
  }
  return tasks.filter(t => t.assigned_to === userProfile.user_id);
}

export async function delegateTask(taskInstance, toUserId, reason, delegatedBy, userProfile) {
  const role = userProfile?.role_level;
  const canDelegate = ['super_admin', 'tenant_admin', 'branch_manager', 'department_head', 'team_lead'].includes(role);
  if (!canDelegate) throw new Error('Insufficient permissions to delegate tasks');

  const originalAssignee = taskInstance.assigned_to;
  await db.entities.TaskInstance.update(taskInstance.id, {
    assigned_to: toUserId,
    assigned_by: delegatedBy,
    delegated_from: originalAssignee,
    is_delegated: true,
    delegation_note: reason,
  });

  await Promise.all([
    db.entities.TaskDelegation.create({
      tenant_id: taskInstance.tenant_id,
      branch_id: taskInstance.branch_id,
      task_instance_id: taskInstance.id,
      delegated_by: delegatedBy,
      delegated_from: originalAssignee,
      delegated_to: toUserId,
      reason,
      status: 'pending_acceptance',
    }),
    db.entities.Notification.create({
      tenant_id: taskInstance.tenant_id,
      branch_id: taskInstance.branch_id,
      user_id: toUserId,
      type: 'task',
      title: `Task Delegated: ${taskInstance.title}`,
      message: `A task was delegated to you.${reason ? ' Reason: ' + reason : ''}`,
      priority: taskInstance.priority === 'urgent' ? 'urgent' : 'normal',
      related_entity: 'TaskInstance',
      related_entity_id: taskInstance.id,
      delivery_status: 'sent',
      sent_at: new Date().toISOString(),
    }),
  ]);
}

export async function updateChecklistItem(taskInstance, itemId, completed, userId) {
  const updatedChecklist = (taskInstance.checklist || []).map(c =>
    c.id === itemId
      ? { ...c, completed, completed_at: completed ? new Date().toISOString() : null, completed_by: completed ? userId : null }
      : c
  );
  const { pct, allRequiredDone } = calcChecklistPct(updatedChecklist);
  await db.entities.TaskInstance.update(taskInstance.id, {
    checklist: updatedChecklist,
    checklist_completion_pct: pct,
    all_required_done: allRequiredDone,
    status: taskInstance.status === 'pending' && pct > 0 ? 'in_progress' : taskInstance.status,
  });
  return { updatedChecklist, pct, allRequiredDone };
}

export async function completeTaskInstance(taskInstance, userId, notes) {
  const { allRequiredDone } = calcChecklistPct(taskInstance.checklist);
  if (!allRequiredDone) throw new Error('Complete all required checklist items first.');
  await db.entities.TaskInstance.update(taskInstance.id, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    completed_by: userId,
    completion_notes: notes || '',
    checklist_completion_pct: 100,
    all_required_done: true,
  });
}