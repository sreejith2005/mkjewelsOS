/** Store Intelligence lives under the existing Sales Recording page id and path. */
export const SI_BASE = "/sales-recording";
export type SiView = "today" | "record" | "conversations" | "conversation" | "coaching" | "insights" | "devices" | "settings";
export const DETAIL_TABS = ["summary", "transcript", "coaching", "actions"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];
export const INSIGHT_VIEWS = ["overview", "conversations", "devices", "sales", "coaching", "customers", "leadership", "rankings"] as const;
export type InsightView = (typeof INSIGHT_VIEWS)[number];
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export type SiRoute = Readonly<{ view: SiView; sessionId?: string; tab: DetailTab; insight: InsightView; range: RangeDays }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSiRoute(path: string, search: string): SiRoute {
  const params = new URLSearchParams(search);
  const tab = DETAIL_TABS.find((value) => value === params.get("tab")) ?? "summary";
  const insight = INSIGHT_VIEWS.find((value) => value === params.get("view")) ?? "overview";
  const range = RANGES.find((value) => String(value) === params.get("range")) ?? 30;
  const rest = path.startsWith(SI_BASE) ? path.slice(SI_BASE.length).replace(/^\/+|\/+$/g, "") : "";
  const [first, second] = rest.split("/");
  const base = { tab, insight, range };
  if (first === "conversations" && second && UUID.test(second)) return { view: "conversation", sessionId: second, ...base };
  if (first === "record" || first === "conversations" || first === "coaching" || first === "insights" || first === "devices" || first === "settings") return { view: first, ...base };
  return { view: "today", ...base };
}

export const siPath = {
  today: () => SI_BASE,
  record: () => `${SI_BASE}/record`,
  conversations: (query = "") => `${SI_BASE}/conversations${query}`,
  conversation: (id: string, tab?: DetailTab) => `${SI_BASE}/conversations/${id}${tab && tab !== "summary" ? `?tab=${tab}` : ""}`,
  coaching: (range?: RangeDays) => `${SI_BASE}/coaching${range && range !== 30 ? `?range=${range}` : ""}`,
  /** Analytics filters (siFiltersToQuery) ride along so a filtered view can be shared. */
  insights: (view: InsightView = "overview", filters: URLSearchParams | string = "") => { const query = String(filters); return `${SI_BASE}/insights?view=${view}${query ? `&${query}` : ""}`; },
  devices: () => `${SI_BASE}/devices`,
  settings: () => `${SI_BASE}/settings`,
};
