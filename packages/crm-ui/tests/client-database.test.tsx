// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const rpc = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ push }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import { ClientDatabase } from "@/components/client-database";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ClientDatabase legacy presentation and queue launch", () => {
  const props = { clients: [{ client_id: "client-1", client_code: "MKC-102707", primary_name: "Anita", primary_phone: "9012345678", city: "Kochi", state: "Kerala", total_visits: 4, last_visit_date: "2026-07-25", last_buy_status: "YES" }], search: "", walkinContext: { role: "salesperson", branchId: "branch-1", branches: [{ id: "branch-1", name: "Kochi" }] } };

  it('lets staff filter leads and clients and preserves those filters in pagination',()=>{
    render(<ClientDatabase {...props} filters={{type:'lead',city:'Kochi'}} paging={{page:1,clientTotal:205,leadCount:0}}/>);
    expect((screen.getByLabelText('Record type') as HTMLSelectElement).value).toBe('lead');
    expect(screen.getAllByRole('link',{name:'NEXT'})[0].getAttribute('href')).toContain('type=lead');
    expect(screen.getAllByRole('link',{name:'NEXT'})[0].getAttribute('href')).toContain('city=Kochi');
  });

  it('opens the same persisted profile for leads',()=>{
    render(<ClientDatabase {...props} clients={[{...props.clients[0],record_type:'lead'}]}/>);
    expect(screen.getByRole('link',{name:'View Client Profile'}).getAttribute('href')).toBe('/clients/client-1');
  });

  it("shows a highlighted record type while retaining the client actions", () => {
    render(<ClientDatabase {...props} />);
    expect(screen.getByText("SEARCH LEADS AND CLIENTS BY PHONE OR NAME. Type is highlighted for every record.")).toBeTruthy();
    expect(screen.getByLabelText("Potential category")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Type", "Client ID", "Name", "Phone", "City", "State", "Total visits", "Registered", "Latest interaction", "Last visit", "Last status", "Action"]);
    expect(screen.getByRole("link", { name: "Register Client" }).getAttribute("href")).toBe("/queue");
    expect(screen.getByText("MKC-102707")).toBeTruthy();
    expect(screen.getByText("CLIENT")).toBeTruthy();
  });

  it("creates an existing-client queue record and opens the canonical queue URL", async () => {
    rpc.mockResolvedValue({ data: [{ id: "queue-1", token: "0729-ABCDE", client_id: "client-1", client_type: "existing" }], error: null });
    render(<ClientDatabase {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Make Walk-in Entry" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_entry_queue", expect.objectContaining({ p_client_id: "client-1", p_branch_id: "branch-1" })));
    expect(push).toHaveBeenCalledWith("/visits/new?queue=queue-1");
  });
});
