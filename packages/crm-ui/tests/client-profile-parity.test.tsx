// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ push }) })); // crm-port: next/navigation -> local shim module

import { ClientProfile } from "@/components/client-profile";
import type { Client } from "@/lib/supabase/app-types";

const client = { client_id: "client-1", primary_name: "Anita", primary_phone: "9012345678", other_names: [], other_known_phones: [], total_visits: 0, total_purchase_visits: 0, total_non_purchase_visits: 0, total_repair_visits: 0, total_order_visits: 0, profile_updated_at: "2026-07-27T00:00:00.000Z", gender: "FEMALE", beverage: "Tea", sugar: "Less sugar", snack: "Biscuits" } as unknown as Client;
const context = { role: "salesperson", branchId: "branch-1", branches: [{ id: "branch-1", name: "Kochi" }] };
function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ClientProfile client={client} timeline={[]} audit={[]} lookups={{ beverages: ["Tea", "Coffee"], snacks: ["Biscuits", "Nuts"] }} walkinContext={context} /></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ClientProfile legacy parity", () => {
  it("uses the walk-in select controls for gender and preferences in explicit edit mode", () => {
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "EDIT PROFILE" }));
    expect(screen.getByLabelText("Gender").tagName).toBe("SELECT");
    expect(screen.getByLabelText("beverage").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Sugar").tagName).toBe("SELECT");
    expect(screen.getByLabelText("snack").tagName).toBe("SELECT");
  });

  it("launches an existing profile through the canonical queue URL", async () => {
    rpc.mockResolvedValue({ data: [{ id: "queue-profile-1", token: "0729-PROF1", client_id: "client-1", client_type: "existing" }], error: null });
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Make Walk-in Entry" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_entry_queue", expect.objectContaining({ p_client_id: "client-1", p_branch_id: "branch-1" })));
    expect(push).toHaveBeenCalledWith("/visits/new?queue=queue-profile-1");
  });

  it("keeps the legacy timeline detail and field-level audit contract visible", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ClientProfile client={client} timeline={[{ id: "timeline-1", created_at: "2026-07-29T10:00:00Z", event_date: "2026-07-29T09:00:00Z", event_type: "VISIT", buy_status: "YES", crm_name: "CRM A", remark: "Important", branch: "Kochi", salesperson: "Sales A", seen_categories: ["Ring"], bought_categories: ["Chain"], order_categories: ["Pendant"], product_requirement: "Bridal", reference_number: "REF-1" }]} audit={[{ id: 1, field_name: "city", old_value: "Old city", new_value: "Kochi", created_at: "2026-07-29T10:00:00Z", editor: "Sales A" }]} lookups={{ beverages: ["Tea"], snacks: ["Biscuits"] }} walkinContext={context} /></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "FULL TIMELINE HISTORY" })).toBeTruthy();
    expect(screen.getByText("Ring")).toBeTruthy();
    expect(screen.getByText("Bridal")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "PROFILE EDIT LOG" })).toBeTruthy();
    expect(screen.getByText("city")).toBeTruthy();
    expect(screen.getByText('"Old city"')).toBeTruthy();
    expect(screen.getByText('"Kochi"')).toBeTruthy();
  });
});
