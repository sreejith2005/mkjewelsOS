export const CALL_OUTCOMES = [
  "YES (CLIENT NEED FOLLOW-UP)",
  "NO (CALL NOT CONNECTED)",
  "NO (CLIENT ASKED FOR APPOINTMENT)",
  "RINGING / NOT ANSWERED",
  "SWITCHED OFF",
  "BUSY / DECLINED",
  "ALREADY PURCHASED FROM MK JEWELS",
  "ALREADY PURCHASED FROM ANOTHER JEWELLER",
  "NO REQUIREMENT AT THE MOMENT (FOLLOW UP AFTER A FEW MONTHS)",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
const NOT_PICKED = new Set<CallOutcome>([
  "NO (CALL NOT CONNECTED)", "RINGING / NOT ANSWERED", "SWITCHED OFF", "BUSY / DECLINED",
]);
const DONE = new Set(["CONVERTED TO CLIENT", "ALREADY PURCHASED FROM MK JEWELS", "NOT INTERESTED", "NO REQUIREMENT AT THE MOMENT", "WRONG NUMBER", "DO NOT CALL", "CLOSED", "CONVERTED", "DONE", "FOLLOW UP DONE"]);
export function callOutcomeBucket(outcome: string | null) { return outcome && NOT_PICKED.has(outcome as CallOutcome) ? "CALL NOT PICKED" : outcome; }
export function isDoneFollowup(status: string) { return DONE.has(status.trim().toUpperCase()); }
export function queueTabMatches(record: { status: string; next_followup_date: string | null; followup_count: number }, tab: string, today: string, converted = false) {
  const done = isDoneFollowup(record.status);
  const status = record.status.trim().toUpperCase();
  const historical = status === "HISTORICAL";
  if (tab === "converted") return converted || record.status === "CONVERTED TO CLIENT";
  if (tab === "done") return done;
  if (tab === "pending") return !done;
  if (tab === "inprocess") return !done && !historical && (record.followup_count > 0 || status !== "PENDING");
  if (historical) return false;
  return !done && (record.next_followup_date === null || record.next_followup_date <= today);
}

export function sortNotBoughtFollowups<T extends { next_followup_date: string | null; visit_date: string | null }>(items: T[], tab: string) {
  const dateFor = (item: T) => item.next_followup_date ?? item.visit_date ?? "0000-00-00";
  return [...items].sort((left, right) => tab === "today"
    ? dateFor(left).localeCompare(dateFor(right))
    : dateFor(right).localeCompare(dateFor(left)));
}

export function legacyNotBoughtHistory<T extends { client_id: string; reference_number: string | null }>(history: T[], clientId: string, referenceNumber: string | null) {
  const exact = history.filter((entry) => entry.client_id === clientId && entry.reference_number === referenceNumber);
  return exact.length ? exact : history.filter((entry) => entry.client_id === clientId);
}
