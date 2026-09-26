// @vitest-environment jsdom
// crm-port addition (no original counterpart): the lead form keeps its original messages for the
// Runo push result now that the push is the crm-runo-push Edge Function.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
const single = vi.fn();
const insert = vi.fn(() => ({ select: () => ({ single }) }));
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ insert }) }) }));
vi.mock("@/crm-port/phase4", () => ({ pushLeadToRuno: (leadId: string) => push(leadId) }));
import { LeadForm } from "@/components/lead-form";

const fields = [{ id: "f1", field_key: "mobile_no", label: "Mobile no", field_type: "text" as const, is_mandatory: true, is_hidden: false, display_order: 10, is_runo_synced: true, runo_field_name: "mobile_no", option_source: null }];
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function saveLead() {
  render(<LeadForm fields={fields} options={[]} lookupOptions={{}} actorId="crm-user-1" />);
  fireEvent.change(screen.getByLabelText("Mobile no"), { target: { value: "9100000601" } });
  fireEvent.click(screen.getByRole("button", { name: "Save lead" }));
  return screen.findByRole("status");
}

describe("LeadForm Runo push message", () => {
  it("says the lead was pushed when the push is ok", async () => {
    single.mockResolvedValue({ data: { id: "lead-1" }, error: null });
    push.mockResolvedValue({ ok: true });
    expect((await saveLead()).textContent).toBe("Lead saved and pushed to Runo.");
    expect(push).toHaveBeenCalledWith("lead-1");
  });

  it("keeps the original local-save message when the push is not ok", async () => {
    single.mockResolvedValue({ data: { id: "lead-1" }, error: null });
    push.mockResolvedValue({ ok: false });
    expect((await saveLead()).textContent).toBe("Lead saved locally. Runo sync not yet configured.");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
