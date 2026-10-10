import { expect, it, vi } from "vitest";
import FollowupsPage from "@/app/(crm)/followups/page";
import ReferralsPage from "@/app/(crm)/referrals/page";

// Fix 2026-10-08: both queues read every row in ordered pages (PostgREST returns at most
// 1000 rows per request) and list the current roster (active crm_allocation) for the CRM filter.
const calls = vi.hoisted(() => ({ ranges: [] as [string, number, number][], filters: [] as [string, string, unknown][] }));
const rows = vi.hoisted(() => ({
  not_bought_followups: Array.from({ length: 501 }, (_, index) => ({ id: `f${index}`, client_id: "c1", reference_number: null, status: "PENDING", next_followup_date: null, remark: null, action_point: null, branch_id: "b1", followup_count: 0, created_at: "2026-10-08T00:00:00Z", clients: { primary_name: "Client", primary_phone: "919000000000" }, client_timeline: { crm_name: "Old Crm" }, visit_forms: null })),
  not_bought_history: [] as unknown[],
  referral_calling: Array.from({ length: 501 }, (_, index) => ({ id: `r${index}`, status: "PENDING", remark: null, next_followup_date: null, followup_count: 0, converted_client_id: null, action_point: null, created_at: "2026-10-08T00:00:00Z", referrals: { crm_name: "Old Crm", assigned_doer: null, salesperson_id: null, given_by_client_id: "c1", referral_name: "R", referral_number: "919000000001", branch_id: "b1", created_at: "2026-10-08T00:00:00Z" } })),
  referral_calling_history: [] as unknown[],
  users: [] as unknown[],
  clients: [{ client_id: "c1", primary_name: "Client" }],
  crm_allocation: [{ crm_name: "Riya Shah" }, { crm_name: "RIYA SHAH" }, { crm_name: "Neel" }],
  branches: [{ id: "b1", name: "Bandra" }, { id: "b2", name: "Andheri" }],
}));
vi.mock("@/components/followup-queue", () => ({ FollowupQueue: () => null }));
vi.mock("@/components/referral-queue", () => ({ ReferralQueue: () => null }));
type Element = { props: Record<string, unknown> & { children?: Element } };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async () => ({ data: [{ role: "salesperson", name: "Tester" }] }),
  auth: { getUser: async () => ({ data: { user: { id: "synthetic" } } }) },
  from: (table: keyof typeof rows) => {
    let range: [number, number] | null = null;
    const query = {
      select: () => query, order: () => query, in: () => query,
      eq: (column: string, value: unknown) => { calls.filters.push([table, column, value]); return query; },
      range: (from: number, to: number) => { range = [from, to]; calls.ranges.push([table, from, to]); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: range ? rows[table].slice(range[0], range[1] + 1) : rows[table], error: null }).then(resolve),
    };
    return query;
  },
}) }));

it("Not Bought reads every follow-up past one page and lists the current roster", async () => {
  const props = ((await FollowupsPage()) as unknown as Element).props;
  expect(calls.ranges.filter(([table]) => table === "not_bought_followups")).toEqual([["not_bought_followups", 0, 499], ["not_bought_followups", 500, 999]]);
  expect((props.items as unknown[]).length).toBe(501);
  expect(props.crmNames).toEqual(["NEEL", "RIYA SHAH"]);
  expect(calls.filters).toContainEqual(["crm_allocation", "active", true]);
  expect(props.branches).toEqual([{ id: "b1", name: "Bandra" }]);
});

it("Referrals reads every referral past one page and lists the current roster", async () => {
  const props = ((await ReferralsPage()) as unknown as Element).props.children!.props;
  expect(calls.ranges.filter(([table]) => table === "referral_calling")).toEqual([["referral_calling", 0, 499], ["referral_calling", 500, 999]]);
  expect((props.items as unknown[]).length).toBe(501);
  expect(props.rosterNames).toEqual(["NEEL", "RIYA SHAH"]);
  expect(props.branches).toEqual([{ id: "b1", name: "Bandra" }]);
});
