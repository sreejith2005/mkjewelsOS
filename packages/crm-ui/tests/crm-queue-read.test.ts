import { expect, it, vi } from "vitest";
import QueuePage from "@/app/(crm)/queue/page";

const error = { code: "", message: "TypeError: Failed to fetch" };
function responseFor(table: string) {
  const result = Promise.resolve(table === "entry_queue" ? { data: null, error } : { data: table === "users" ? { branch_id: "branch-1" } : [], error: null });
  const query = { select: () => query, eq: () => query, order: () => query, single: () => result, then: result.then.bind(result) };
  return query;
}
vi.mock("@/crm-port/crm-user", () => ({ getCrmUser: async () => ({ data: { user: { id: "synthetic" } } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: responseFor, rpc: async () => ({ data: [{ role: "salesperson" }], error: null }) }) }));

it("propagates a failed queue read instead of hiding pending and recent work", async () => {
  await expect(QueuePage({ searchParams: Promise.resolve({}) })).rejects.toBe(error);
});
