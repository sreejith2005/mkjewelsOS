# MK Jewels seed data (source of truth for the seed script) — v2

## Tenant
- name: MK JEWELS
- slug: mk-jewels
- currency: INR, timezone: Asia/Kolkata

## Branches (tenant = MK JEWELS) — name / code
- BANDRA / BAN
- ZAVERI BAZAR / ZVB
- ANDHERI / AND
- EXHIBITION / EXH

## Departments (tenant-level) — name / code
- SALES / SALES
- CRM / CRM
- INVENTORY / INV
- HR / HR
- ACCOUNTS / ACC
- OPERATIONS / OPS
- MANAGEMENT / MGT
- HOUSEKEEPING / HSK

## Default users (create via Supabase Auth admin API, then insert matching
## user_profiles row — do NOT insert directly into auth.users via raw SQL)
All personal_mobile values below are PLACEHOLDER DEV DATA — clearly comment
this in code, do not treat as real employee contact info.

1. email: admin@mkjewels.local / password: admin123 / role: super_admin
   employee_name: Super Admin, branch: BANDRA, department: MANAGEMENT
   employee_code: MK-0001, personal_mobile: +91 90000 00001
2. email: crm@mkjewels.local / password: crm123 / role: crm
   employee_name: CRM User, branch: BANDRA, department: CRM
   employee_code: MK-0002, personal_mobile: +91 90000 00002
3. email: sales@mkjewels.local / password: sales123 / role: staff
   employee_name: Sales User, branch: BANDRA, department: SALES
   employee_code: MK-0003, personal_mobile: +91 90000 00003

All three: week_off = ['Sunday'], working_status = 'active',
is_login_enabled = true.

## dropdown_masters seed values (master_type -> [values])
CONFIRMED: these values are authoritative and intentionally supersede
anything different found in the Base44 reference codebase, EXCEPT
resignation_reason (see note below).

- working_status: ACTIVE, INACTIVE, ON LEAVE, HALF DAY, RESIGNED
  (source: original client spec, Section 5 — not Base44's drifted version)
- resignation_reason: Better Opportunity, Higher Studies, Relocation,
  Health, Family Reasons, Personal Reasons, Performance, Other
  (merged list — Base44's version adopted here since original spec left
  this open and Base44's list is more complete)
- crm_source: Walk-in, Referral, Instagram, Google, Exhibition, Other
- client_type: Regular, VIP, Wholesale, Corporate
- task_priority: HIGH, MEDIUM, LOW
- task_status: PENDING, IN_PROGRESS, IN_REVIEW, COMPLETED, REJECTED,
  BLOCKED, OVERDUE
- week_off: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday

## Default FMS flow (create as draft — do not auto-publish)
Name: Not Bought Follow-up
Stages: Not Bought Created -> Follow-up Call within 48 hours ->
Revisit Scheduled -> Revisit Done -> Converted / Lost (branch)

## Default forms (create as empty templates, fields added later in Phase 4)
- Walk-in Form
- Task Completion Form
- FMS Stage Completion Form
- Resignation Form

## Environment variables the seed script must read
- SUPABASE_URL           (already established convention from apps/*/.env)
- SEED_SUPABASE_SERVICE_ROLE_KEY  (service_role key, dev-session-only,
  never committed, never logged)