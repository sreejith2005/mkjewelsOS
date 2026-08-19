/* ---------------------------------------------------------------------------
   Organisation master data.
   In production these come from the Tenant / Branch / Department / UserProfile
   tables. Replace each export with a fetch and the rest of the app is unchanged.
   --------------------------------------------------------------------------- */

export const TENANT = {
  id: "t1",
  name: "MK Jewels",
  slug: "mk-jewels",
  subscription_plan: "enterprise",
  currency: "INR",
  timezone: "Asia/Kolkata",
};

export const BRANCHES = [
  { id: "b1", tenant_id: "t1", name: "Bandra Showroom", code: "BND", type: "showroom", city: "Mumbai", manager_id: "u2" },
  { id: "b2", tenant_id: "t1", name: "Andheri Showroom", code: "AND", type: "showroom", city: "Mumbai", manager_id: "u3" },
  { id: "b3", tenant_id: "t1", name: "Zaveri Bazar Workshop", code: "ZVB", type: "workshop", city: "Mumbai", manager_id: "u7" },
];

export const DEPARTMENTS = [
  { id: "d1", name: "Management", code: "MGT", type: "management", head_id: "u1" },
  { id: "d2", name: "Sales", code: "SLS", type: "sales", head_id: "u2" },
  { id: "d3", name: "Workshop", code: "WKS", type: "workshop", head_id: "u5" },
  { id: "d4", name: "Customer Service", code: "CSV", type: "customer_service", head_id: "u6" },
  { id: "d5", name: "Inventory", code: "INV", type: "inventory", head_id: "u7" },
  { id: "d6", name: "Marketing", code: "MKT", type: "marketing", head_id: "u2" },
];

export const USERS = [
  { id: "u1", user_id: "au1", tenant_id: "t1", name: "Sanket Mehta", email: "sanket@mkjewels.in", branch_id: "b1", department_id: "d1", role_level: "super_admin", designation: "Director", employee_code: "MK001", week_off: ["sunday"], working_status: "active", reporting_to: null, accessible_branches: ["b1", "b2", "b3"], last_login: "2 min ago" },
  { id: "u2", user_id: "au2", tenant_id: "t1", name: "Rhea Kapoor", email: "rhea@mkjewels.in", branch_id: "b1", department_id: "d2", role_level: "manager", designation: "Showroom Manager", employee_code: "MK014", week_off: ["tuesday"], working_status: "active", reporting_to: "u1", accessible_branches: ["b1", "b2"], last_login: "18 min ago" },
  { id: "u3", user_id: "au3", tenant_id: "t1", name: "Aditya Shah", email: "aditya@mkjewels.in", branch_id: "b2", department_id: "d2", role_level: "team_lead", designation: "Senior Sales Lead", employee_code: "MK022", week_off: ["wednesday"], working_status: "active", reporting_to: "u2", accessible_branches: ["b2"], last_login: "1 hr ago" },
  { id: "u4", user_id: "au4", tenant_id: "t1", name: "Priya Nair", email: "priya@mkjewels.in", branch_id: "b1", department_id: "d2", role_level: "staff", designation: "Sales Associate", employee_code: "MK031", week_off: ["monday"], working_status: "active", reporting_to: "u2", accessible_branches: ["b1"], last_login: "3 hr ago" },
  { id: "u5", user_id: "au5", tenant_id: "t1", name: "Imran Qureshi", email: "imran@mkjewels.in", branch_id: "b3", department_id: "d3", role_level: "staff", designation: "Master Karigar", employee_code: "MK008", week_off: ["sunday"], working_status: "active", reporting_to: "u7", accessible_branches: ["b3"], last_login: "Yesterday" },
  { id: "u6", user_id: "au6", tenant_id: "t1", name: "Neha Joshi", email: "neha@mkjewels.in", branch_id: "b2", department_id: "d4", role_level: "staff", designation: "Client Relations", employee_code: "MK037", week_off: ["thursday"], working_status: "active", reporting_to: "u3", accessible_branches: ["b2"], last_login: "40 min ago" },
  { id: "u7", user_id: "au7", tenant_id: "t1", name: "Vikram Rao", email: "vikram@mkjewels.in", branch_id: "b3", department_id: "d5", role_level: "manager", designation: "Inventory Head", employee_code: "MK005", week_off: ["sunday"], working_status: "active", reporting_to: "u1", accessible_branches: ["b3", "b1"], last_login: "5 hr ago" },
  { id: "u8", user_id: "au8", tenant_id: "t1", name: "Farah Sheikh", email: "farah@mkjewels.in", branch_id: "b1", department_id: "d2", role_level: "staff", designation: "Sales Associate", employee_code: "MK044", week_off: ["friday"], working_status: "on_leave", reporting_to: "u2", accessible_branches: ["b1"], last_login: "6 days ago" },
  { id: "u9", user_id: "au9", tenant_id: "t1", name: "Rakesh Pillai", email: "rakesh@mkjewels.in", branch_id: "b2", department_id: "d2", role_level: "staff", designation: "Sales Associate", employee_code: "MK029", week_off: ["monday"], working_status: "resigned", reporting_to: "u3", accessible_branches: ["b2"], last_login: "22 days ago", resignation_date: "2026-07-18", exit_interview_done: true, assets_returned: true, full_and_final_cleared: false, rehire_eligible: true },
];

export const DROPDOWN_CONFIG = {
  branch_types: ["showroom", "warehouse", "workshop", "franchise"],
  role_levels: ["super_admin", "admin", "manager", "team_lead", "staff"],
  designations: ["Director", "Showroom Manager", "Senior Sales Lead", "Sales Associate", "Master Karigar", "Client Relations", "Inventory Head"],
  week_off_days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  customer_types: ["regular", "vip", "wholesale", "corporate"],
  customer_sources: ["walk_in", "referral", "instagram", "trade_show", "corporate_tie_up"],
  interaction_types: ["call", "visit", "whatsapp", "follow_up"],
  resignation_reasons: ["Better opportunity", "Relocation", "Personal", "Performance", "Retirement"],
  task_priorities: ["low", "medium", "high", "urgent"],
  flow_categories: ["sales", "service", "inventory", "procurement", "hr"],
};

export const branchOf = (id) => BRANCHES.find((b) => b.id === id);
export const deptOf = (id) => DEPARTMENTS.find((d) => d.id === id);
export const userOf = (id) => USERS.find((u) => u.id === id);
