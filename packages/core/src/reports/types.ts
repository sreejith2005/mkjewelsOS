import type { UserRole } from "../roleMenu.ts";

/** JewelOS report filters (get_report_data) and CRM report filters (get_crm_business_report). */
export type ReportFilterKey =
  | "from" | "to" | "branch_id" | "department_id" | "status" | "user_profile_id" | "page" | "page_size"
  | "form_family_id" | "flow_family_id" | "stage_key" | "work_kind" | "search"
  | "crm_branch_id" | "crm_employee_id" | "crm_name" | "source" | "customer_type" | "purchase_class" | "client_id";

/** How a cell is shown and exported. Phones stay text; instants are shown in Asia/Kolkata. */
export type ReportColumnFormat = "text" | "phone" | "instant" | "date" | "boolean" | "number" | "percent" | "minutes" | "hours" | "status";
export type ReportColumn = Readonly<{ key: string; label: string; sensitive?: boolean; format?: ReportColumnFormat }>;

export type ReportCategory = "customers" | "operations" | "people" | "admin" | "legacy";
/** jewelos: get_report_data + request_report_export_with_audit. crm: the CRM project through the login bridge. */
export type ReportSource = "jewelos" | "crm";

export type ReportDefinition = Readonly<{
  key: string;
  name: string;
  description: string;
  roles: readonly UserRole[];
  filters: readonly ReportFilterKey[];
  columns: readonly ReportColumn[];
  defaultSort: string;
  maxDateRangeDays: number;
  exportEligible: boolean;
  category?: ReportCategory;
  source?: ReportSource;
  /** Extra permission the reader needs (CRM reports need CRM access). */
  permission?: string;
  /** Reports sharing a family are one card with a mode switch. */
  family?: string;
  variantLabel?: string;
  /** What the date range means for this report. */
  dateLabel?: string;
  /** The date range may be left empty (all dates). */
  dateOptional?: boolean;
  /** Labels for the server's summary figures, in display order. */
  summary?: readonly Readonly<{ key: string; label: string }>[];
  /** Plain-language definitions of the counts, shown under the table. */
  notes?: readonly string[];
}>;

export type ReportFilters = Readonly<{
  from?: string;
  to?: string;
  branch_id?: string;
  department_id?: string;
  status?: string;
  user_profile_id?: string;
  form_family_id?: string;
  flow_family_id?: string;
  stage_key?: string;
  work_kind?: string;
  search?: string;
  crm_branch_id?: string;
  crm_employee_id?: string;
  crm_name?: string;
  source?: string;
  customer_type?: string;
  purchase_class?: string;
  client_id?: string;
  page: number;
  page_size: number;
}>;
