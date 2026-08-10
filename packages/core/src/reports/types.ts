import type { UserRole } from "../roleMenu";

export type ReportFilterKey = "from" | "to" | "branch_id" | "department_id" | "status" | "user_profile_id" | "page" | "page_size";
export type ReportColumn = Readonly<{ key: string; label: string; sensitive?: boolean }>;
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
}>;

export type ReportFilters = Readonly<{
  from?: string;
  to?: string;
  branch_id?: string;
  department_id?: string;
  status?: string;
  user_profile_id?: string;
  page: number;
  page_size: number;
}>;
