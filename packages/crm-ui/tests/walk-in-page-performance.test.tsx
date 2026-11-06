import { expect, it, vi } from "vitest";
import NewVisitPage from "@/app/(crm)/visits/new/page";

const reads = vi.hoisted(() => ({ started: [] as string[], actor: Promise.resolve({ data: { branch_id: "branch", name: "Staff" }, error: null }) }));
vi.mock("@/crm-port/crm-user", () => ({ getCrmUser: async () => ({ data: { user: { id: "staff" } } }) }));
vi.mock("@/components/walkin-visit-entry", () => ({ WalkinVisitEntry: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: (name: string) => {
    reads.started.push(name);
    const data = name === "get_my_profile" ? [{ role: "salesperson" }] : name === "get_crm_master_options" ? {} : [];
    return Object.assign(Promise.resolve({ data, error: null }), {
      single: async () => ({ data: { client_id: "client" }, error: null }),
    });
  },
  from: (table: string) => {
    const result = () => {
      reads.started.push(table);
      return table === "users" ? reads.actor : Promise.resolve({ data: table === "entry_queue" ? { id: "queue", status: "pending", branch_id: "branch", client_id: "client" } : [], error: null });
    };
    const query = { select: () => query, eq: () => query, order: () => query, single: result, then: (resolve: (value: unknown) => unknown) => result().then(resolve) };
    return query;
  },
}) }));

it("loads walk-in allocation and availability alongside independent actor and queue details", async () => {
  let finishActor!: (value: { data: { branch_id: string; name: string }; error: null }) => void;
  reads.started = [];
  reads.actor = new Promise((resolve) => { finishActor = resolve; });
  const pending = NewVisitPage({ searchParams: Promise.resolve({ queue: "queue" }) });
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  const startedBeforeActor = [...reads.started];
  finishActor({ data: { branch_id: "branch", name: "Staff" }, error: null });
  await pending;
  expect(startedBeforeActor).toContain("users");
  expect(startedBeforeActor).toContain("get_walkin_crm_roster");
  expect(startedBeforeActor).toContain("crm_daily_availability");
  expect(startedBeforeActor).toContain("get_walkin_salespeople");
  expect(startedBeforeActor).toContain("get_client_profile");
  expect(startedBeforeActor).toContain("get_walkin_profile_defaults");
});
