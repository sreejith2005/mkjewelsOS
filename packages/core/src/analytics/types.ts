import type { UserRole } from "../roleMenu";

export const DATE_RANGE_PRESETS = ["today", "this_week", "this_month", "last_7_days", "last_30_days", "custom"] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export type DateRange = Readonly<{
  preset: DateRangePreset;
  localStart: string;
  localEndExclusive: string;
  timezone: string;
}>;

export type MetricFormat = "count" | "percentage" | "duration_minutes";
export type EmptyBehavior = "zero" | "no_data" | "not_applicable";

export type MetricDefinition = Readonly<{
  key: string;
  displayName: string;
  definition: string;
  numerator: string | null;
  denominator: string | null;
  roles: readonly UserRole[];
  sourceModule: "tasks" | "fms" | "forms" | "crm" | "notifications" | "people";
  dateWindow: string;
  scope: string;
  emptyBehavior: EmptyBehavior;
  format: MetricFormat;
  comparable: boolean;
}>;

export type MetricValue = Readonly<{
  key: string;
  value: number | null;
  numerator?: number | null;
  denominator?: number | null;
  previousValue?: number | null;
}>;
