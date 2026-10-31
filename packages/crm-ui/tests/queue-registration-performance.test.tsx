// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const refresh = vi.fn();
const rpc = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/lib/client-phone-lookup", () => ({ lookupClientByPhone: async () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { EntryQueue } from "@/components/entry-queue";

const branch = "10000000-0000-4000-8000-000000000601";
const row = { id: "queue-committed", token: "TOKEN", client_id: "client-committed", client_code: "MKC-100001", client_type: "new", client_name: "Saved Client", mobile: "919012345678", branch_id: branch, assigned_crm_name: "Test CRM", status: "pending", created_at: "2026-10-08T10:00:00Z", client_is_new: true };
const props = { profile: { role: "salesperson", branchId: branch }, selectedBranchId: branch, selectedCrm: "", branches: [{ id: branch, name: "Test Branch" }], crms: ["Test CRM"], queueCrms: ["Test CRM"], initialItems: [] };
function submit() {
  fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Saved Client" } });
  fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "9012345678" } });
  fireEvent.click(screen.getByRole("button", { name: "REGISTER CLIENT" }));
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("shows the server's committed queue row before a page refresh completes", async () => {
  rpc.mockResolvedValue({ data: [row], error: null });
  const view = render(<EntryQueue {...props} />);
  submit();
  const saved = await screen.findByRole("row", { name: /Saved Client/ });
  expect(within(saved).getByRole("link").getAttribute("href")).toBe("/visits/new?queue=queue-committed");
  expect(rpc).toHaveBeenCalledWith("register_walkin_entry", expect.anything());
  // An older overlapping refresh cannot erase the acknowledged write.
  view.rerender(<EntryQueue {...props} initialItems={[]} />);
  expect(screen.getAllByRole("row", { name: /Saved Client/ })).toHaveLength(1);
  view.rerender(<EntryQueue {...props} initialItems={[{ ...row, status: "complete" }]} />);
  expect(screen.queryByRole("row", { name: /Saved Client/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Recently submitted" }));
  expect(screen.getAllByRole("row", { name: /Saved Client/ })).toHaveLength(1);
});

it("does not invent a queue row on failed registration", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  render(<EntryQueue {...props} />); submit();
  await screen.findByText(/Could not register/);
  expect(screen.queryByRole("row", { name: /Saved Client/ })).toBeNull();
});

it("keeps the loaded CRM filter when the committed row belongs to another CRM", async () => {
  rpc.mockResolvedValue({ data: [{ ...row, assigned_crm_name: "Other CRM" }], error: null });
  render(<EntryQueue {...props} selectedCrm="Test CRM" />); submit();
  await screen.findByText(/MKC-100001/);
  expect(screen.queryByRole("row", { name: /Saved Client/ })).toBeNull();
});
