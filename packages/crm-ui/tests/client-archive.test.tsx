// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
import { ClientArchiveControls } from "@/components/client-archive";

const view = () => render(<QueryClientProvider client={new QueryClient()}><ClientArchiveControls clientId="client" /></QueryClientProvider>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows nothing to staff for an active client", async () => {
  rpc.mockResolvedValue({ data: { archived: false, can_archive: false }, error: null });
  const { container } = view();
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_client_archive_state", { p_client_id: "client" }));
  expect(container.textContent).toBe("");
});

it("archives through the audited server contract only with a reason", async () => {
  rpc.mockImplementation((name: string) => Promise.resolve(name === "get_client_archive_state"
    ? { data: { archived: false, can_archive: true }, error: null } : { data: null, error: null }));
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Archive client" }));
  const confirm = screen.getAllByRole("button", { name: "Archive client" }).at(-1)!;
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Archive reason"), { target: { value: "Duplicate of MKC-1" } });
  fireEvent.click(confirm);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("archive_client", { p_client_id: "client", p_reason: "Duplicate of MKC-1" }));
});

it("shows the archive banner, and Restore only to Super Admin", async () => {
  rpc.mockResolvedValue({ data: { archived: true, archived_at: "2026-11-07T08:00:00Z", archive_reason: "Test record", archived_by_name: "SA", can_archive: false }, error: null });
  view();
  expect(await screen.findByText("This client is archived")).toBeTruthy();
  expect(screen.getByText(/Reason: Test record/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Restore client" })).toBeNull();
});
