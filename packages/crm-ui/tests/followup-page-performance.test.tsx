import { expect, it, vi } from "vitest";
import FollowupsPage from "@/app/(crm)/followups/page";

const mocks = vi.hoisted(() => ({ followups: vi.fn(), history: vi.fn() }));
vi.mock("@/components/followup-queue", () => ({ FollowupQueue: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async () => ({ data: [{ role: "salesperson" }] }),
  auth: { getUser: async () => ({ data: { user: { id: "synthetic" } } }) },
  from: (table: string) => {
    const read = table === "not_bought_followups" ? mocks.followups : mocks.history;
    const query = { select: () => query, order: () => query, then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => read().then(resolve, reject) };
    return query;
  },
}) }));

it("starts followup history without waiting for the followup list", async () => {
  let finish!: (result: { data: [] }) => void;
  mocks.followups.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  mocks.history.mockResolvedValue({ data: [] });
  const load = FollowupsPage();
  await vi.waitFor(() => expect(mocks.followups).toHaveBeenCalledOnce());
  expect(mocks.history).toHaveBeenCalledOnce();
  finish({ data: [] }); await load;
});
