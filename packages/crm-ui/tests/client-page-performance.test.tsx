import { expect, it, vi } from "vitest";
import ClientPage from "@/app/(crm)/clients/[clientId]/page";

const reads = vi.hoisted(() => ({ started: [] as string[], userBranch: Promise.resolve({ data: { branch_id: "b1" }, error: null }) }));
vi.mock("@/components/client-profile", () => ({ ClientProfile: () => null }));
vi.mock("@/crm-port/crm-user", () => ({ getCrmUser: async () => ({ data: { user: { id: "actor" } } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: (name: string) => name === "get_client_profile"
    ? { single: async () => ({ data: { client_id: "c1", last_branch_id: "b1", last_salesperson_id: "salesperson" }, error: null }) }
    : Promise.resolve({ data: name === "get_crm_master_options" ? {} : [{ role: "salesperson" }], error: null }),
  from: (table: string) => {
    let actor = false;
    const data = table === "client_identity" ? { household_id: "household" }
      : table === "client_timeline" ? [{ id: "visit", branch_id: "b1", salesperson_id: "salesperson" }]
      : table === "branches" ? [{ id: "b1", name: "Main" }]
      : table === "users" ? [{ id: "salesperson", name: "Employee" }]
      : table === "clients" ? [{ client_id: "family", client_code: "MKC-2", primary_name: "Family" }]
      : [];
    const result = () => { reads.started.push(actor ? "actor_branch" : table); return actor ? reads.userBranch : Promise.resolve({ data, error: null }); };
    const query = {
      select: () => query,
      eq: (column: string) => { if (table === "users" && column === "id") actor = true; return query; },
      neq: () => query, order: () => query, in: () => query, range: () => query, limit: () => query,
      single: result, maybeSingle: result,
      then: (resolve: (value: unknown) => unknown) => result().then(resolve),
    };
    return query;
  },
}) }));

it("loads independent client history details while the actor branch read is still pending", async () => {
  let finishBranch!: (value: { data: { branch_id: string }; error: null }) => void;
  reads.started = [];
  reads.userBranch = new Promise((resolve) => { finishBranch = resolve; });
  const pending = ClientPage({ params: Promise.resolve({ clientId: "c1" }) });
  // Flush already resolved query work without releasing the actor's independent read.
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  const startedBeforeBranch = [...reads.started];
  finishBranch({ data: { branch_id: "b1" }, error: null });
  const page = await pending;
  expect(startedBeforeBranch).toContain("actor_branch");
  expect(startedBeforeBranch).toContain("clients");
  expect(startedBeforeBranch).toContain("visit_forms");
  expect(startedBeforeBranch).toContain("documents");
  expect(page.props.family).toHaveLength(1);
  expect(page.props.walkinContext.branchId).toBe("b1");
});
