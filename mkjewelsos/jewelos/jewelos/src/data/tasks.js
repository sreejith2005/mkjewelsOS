import { uid, TODAY_ISO } from "../lib/utils.js";

/* Recurring schedules + the instances they spawn for a given day. */

export const RECURRING_TASKS = [
  { id: "rt1", branch_id: "b1", title: "Open showroom & verify display stock", recurrence_type: "daily", recurrence_days: [], recurrence_time: "10:30", assigned_to: "u4", auto_delegate: true, priority: "high", sla_minutes: 60, checklist_items: ["Unlock and disarm alarm", "Count display trays against tally", "Switch on showcase lighting", "Log opening time in register"] },
  { id: "rt2", branch_id: "b1", title: "Call yesterday's walk-ins", recurrence_type: "daily", recurrence_days: [], recurrence_time: "12:00", assigned_to: "u4", auto_delegate: false, priority: "medium", sla_minutes: 180, checklist_items: ["Pull walk-in register", "Call each lead", "Log outcome in CRM"] },
  { id: "rt3", branch_id: "b3", title: "Karigar work-in-progress review", recurrence_type: "daily", recurrence_days: [], recurrence_time: "11:00", assigned_to: "u5", auto_delegate: false, priority: "high", sla_minutes: 120, checklist_items: ["Weigh in-process gold", "Update job card status", "Flag overdue jobs"] },
  { id: "rt4", branch_id: "b2", title: "Weekly sales target review", recurrence_type: "weekly", recurrence_days: ["monday"], recurrence_time: "09:30", assigned_to: "u3", auto_delegate: false, priority: "high", sla_minutes: 90, checklist_items: ["Pull last week's numbers", "Compare to target", "Set this week's focus"] },
  { id: "rt5", branch_id: "b1", title: "VIP birthday & anniversary outreach", recurrence_type: "daily", recurrence_days: [], recurrence_time: "11:30", assigned_to: "u6", auto_delegate: true, priority: "medium", sla_minutes: 240, checklist_items: ["Check today's celebrant list", "Send personalised message", "Offer a store visit"] },
  { id: "rt6", branch_id: "b3", title: "Vault reconciliation", recurrence_type: "weekly", recurrence_days: ["saturday"], recurrence_time: "18:00", assigned_to: "u7", auto_delegate: false, priority: "urgent", sla_minutes: 120, checklist_items: ["Physical count", "Match to system", "Sign off with second custodian"] },
];

/* Mirrors recurringTaskEngine.generateTodayInstances(): one instance per
   schedule per day, skipping week-offs and anyone not actively working. */
const mk = (rt, over = {}) => ({
  id: uid("ti"),
  recurring_task_id: rt.id,
  title: rt.title,
  branch_id: rt.branch_id,
  due_date_only: TODAY_ISO,
  planned_time: rt.recurrence_time,
  sla_minutes: rt.sla_minutes,
  assigned_to: rt.assigned_to,
  priority: rt.priority,
  status: "pending",
  is_delegated: false,
  delegated_from: null,
  sla_breached: false,
  checklist: rt.checklist_items.map((t) => ({ id: uid("cl"), text: t, done: false })),
  ...over,
});

export const seedInstances = () => [
  mk(RECURRING_TASKS[0], {
    status: "completed",
    checklist: RECURRING_TASKS[0].checklist_items.map((t) => ({ id: uid("cl"), text: t, done: true })),
  }),
  mk(RECURRING_TASKS[1]),
  mk(RECURRING_TASKS[2], { sla_breached: true, priority: "urgent" }),
  mk(RECURRING_TASKS[3], { assigned_to: "u4", is_delegated: true, delegated_from: "u3" }),
  mk(RECURRING_TASKS[4]),
  mk(RECURRING_TASKS[5], { assigned_to: "u5", is_delegated: true, delegated_from: "u7", priority: "urgent" }),
  {
    id: uid("ti"), recurring_task_id: null, title: "Prepare Meera Iyer's bridal quotation",
    branch_id: "b2", due_date_only: TODAY_ISO, planned_time: "15:00", sla_minutes: 120,
    assigned_to: "u3", priority: "urgent", status: "pending", is_delegated: false,
    delegated_from: null, sla_breached: false,
    checklist: [
      { id: uid("cl"), text: "Confirm polki weight with workshop", done: true },
      { id: uid("cl"), text: "Apply VIP making-charge slab", done: false },
      { id: uid("cl"), text: "Send PDF on WhatsApp", done: false },
    ],
  },
  {
    id: uid("ti"), recurring_task_id: null, title: "Photograph new Navratna arrivals",
    branch_id: "b1", due_date_only: TODAY_ISO, planned_time: "16:30", sla_minutes: 180,
    assigned_to: "u4", priority: "low", status: "pending", is_delegated: false,
    delegated_from: null, sla_breached: false,
    checklist: [
      { id: uid("cl"), text: "Set up lightbox", done: false },
      { id: uid("cl"), text: "Shoot 12 SKUs", done: false },
    ],
  },
];

export const seedNotifications = () => [
  { id: "n1", user_id: "u1", type: "workflow", title: "Waiting on your sign-off", message: "Meera Iyer's bridal set is over \u20b95L and needs Director approval. It has been sitting 26 hours.", is_read: false, priority: "urgent", page: "FMSBuilder", when: "26 hr ago" },
  { id: "n2", user_id: "u4", type: "task", title: "Karigar review breached its SLA", message: "Work-in-progress review at Zaveri Bazar was due at 11:00 and is still open.", is_read: false, priority: "high", page: "MyTasks", when: "3 hr ago" },
  { id: "n3", user_id: "u4", type: "alert", title: "Ananya Desai's follow-up is due today", message: "She shortlisted three solitaires two days ago and asked about a matching band.", is_read: false, priority: "high", page: "CRM", when: "5 hr ago" },
  { id: "n4", user_id: "u4", type: "task", title: "Aditya delegated a task to you", message: "Weekly sales target review \u2014 Andheri. Reason: he's at the trade show until Thursday.", is_read: false, priority: "medium", page: "MyTasks", when: "Yesterday" },
  { id: "n5", user_id: "u4", type: "announcement", title: "Diwali collection preview on 14 Aug", message: "All showroom staff to attend the 9:30 briefing at Bandra. Karigars join on video.", is_read: true, priority: "low", page: "Home", when: "2 days ago" },
  { id: "n6", user_id: "u4", type: "alert", title: "Three VIP birthdays this week", message: "Meera Iyer, Sneha Kulkarni and Zoya Merchant. Outreach task has been created.", is_read: true, priority: "medium", page: "CRM", when: "2 days ago" },
];
