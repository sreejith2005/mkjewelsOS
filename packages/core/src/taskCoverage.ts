const KOLKATA_TIME_ZONE = "Asia/Kolkata";
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MOVABLE_STATUSES = new Set(["assigned", "open", "pending", "queued", "ready"]);
const REVIEW_STATUSES = new Set(["claimed", "in_progress"]);

export type TaskCoverageProfile = {
  id: string;
  week_off: readonly string[];
  working_status: string;
};

export type TaskCoverageResolution =
  | "coverage_required"
  | "original"
  | "primary_buddy"
  | "reporting_manager"
  | "secondary_buddy";

export type TaskCoverageDecision = {
  effectiveAssigneeId: string | null;
  originalAssigneeId: string;
  resolution: TaskCoverageResolution;
};

export type TaskCoverageInput = {
  availabilityByUser: ReadonlyMap<string, string>;
  manager?: TaskCoverageProfile | undefined;
  original: TaskCoverageProfile;
  primary?: TaskCoverageProfile | undefined;
  secondary?: TaskCoverageProfile | undefined;
  targetDate: Date | string;
};

function dateKey(value: Date | string): string {
  if (typeof value === "string" && DATE_ONLY_PATTERN.test(value)) return value;
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) throw new Error("Target date is invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: KOLKATA_TIME_ZONE,
    year: "numeric",
  }).formatToParts(parsed);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function weekdayName(value: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: KOLKATA_TIME_ZONE,
    weekday: "long",
  }).format(new Date(`${dateKey(value)}T12:00:00.000Z`)).toLowerCase();
}

export function isCoverageCandidateAvailable(
  profile: TaskCoverageProfile | undefined,
  availabilityStatus: string | null | undefined,
  targetDate: Date | string,
): boolean {
  if (!profile || profile.working_status !== "active" || availabilityStatus === "absent") return false;
  const weekday = weekdayName(targetDate);
  return !profile.week_off.some((day) => day.trim().toLowerCase() === weekday);
}

export function resolveTaskCoverage(input: TaskCoverageInput): TaskCoverageDecision {
  const candidates = [
    [input.original, "original"],
    [input.primary, "primary_buddy"],
    [input.secondary, "secondary_buddy"],
    [input.manager, "reporting_manager"],
  ] as const;
  const seen = new Set<string>();
  for (const [candidate, resolution] of candidates) {
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (isCoverageCandidateAvailable(candidate, input.availabilityByUser.get(candidate.id), input.targetDate)) {
      return {
        effectiveAssigneeId: candidate.id,
        originalAssigneeId: input.original.id,
        resolution,
      };
    }
  }
  return {
    effectiveAssigneeId: null,
    originalAssigneeId: input.original.id,
    resolution: "coverage_required",
  };
}

export function classifyCoverageWindow(
  deadline: string,
  status: string,
  now = new Date(),
): "ignore" | "move" | "review" {
  const normalizedStatus = status.trim().toLowerCase().replaceAll(" ", "_");
  const today = dateKey(now);
  const tomorrowDate = new Date(`${today}T00:00:00.000+05:30`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const deadlineDate = dateKey(deadline);
  if (deadlineDate !== today && deadlineDate !== dateKey(tomorrowDate)) return "ignore";
  if (MOVABLE_STATUSES.has(normalizedStatus)) return "move";
  if (REVIEW_STATUSES.has(normalizedStatus)) return "review";
  return "ignore";
}
