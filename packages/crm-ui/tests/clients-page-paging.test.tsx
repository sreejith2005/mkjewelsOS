// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const TOTAL = 205;
const lead = { id: "lead-1", phone_number: "9100000001", name: "Synthetic Lead", field_values: {}, created_at: "2026-10-01T10:00:00Z", client_id: "lead-client", clients: { client_code: "MKC-200001", total_visits: 0 } };

function clientRows(offset: number, limit: number) {
  return Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) }, (_, index) => {
    const n = offset + index + 1;
    return { client_id: `client-${n}`, client_code: `MKC-${100000 + n}`, primary_name: `Synthetic ${n}`, primary_phone: `91000${String(n).padStart(5, "0")}`, city: null, state: null, total_visits: 1, last_visit_date: "2026-09-01T10:00:00Z", last_buy_status: "YES", client_potential_category: null, total_count: TOTAL };
  });
}

const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
  if (name === "browse_clients_page") return { data: clientRows(Number(args.page_offset), Number(args.result_limit)), error: null };
  if (name === "get_my_profile") return { data: [{ role: "salesperson" }], error: null };
  return { data: null, error: null };
});

function responseFor(table: string) {
  const data = table === "leads" ? [lead] : table === "users" ? { branch_id: null } : [];
  const result = Promise.resolve({ data, error: null });
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => result, single: () => result, then: result.then.bind(result) };
  return query;
}

vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: vi.fn() }) }));
vi.mock("@/crm-port/crm-user", () => ({ getCrmUser: vi.fn(async () => ({ data: { user: null } })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: responseFor, rpc })) }));

import ClientsPage from "@/app/(crm)/clients/page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function browseCalls() {
  return rpc.mock.calls.filter(([name]) => name === "browse_clients_page").map(([, args]) => args);
}

describe("Client Database paging", () => {
  it("shows leads and the first 200 clients on page 1, with the total of every match", async () => {
    render(await ClientsPage({ searchParams: Promise.resolve({}) }));

    expect(browseCalls()).toEqual([{ search_text: null, potential_category: null, exclude_unvisited_leads: true, page_offset: 0, result_limit: 200 }]);
    expect(screen.getByText("206 RESULT(S) FOUND.")).toBeTruthy();
    expect(screen.getAllByText("SHOWING CLIENTS 1-200 OF 205")).toHaveLength(2);
    expect(screen.getByText("Synthetic Lead")).toBeTruthy();
    expect(screen.getByText("Synthetic 200")).toBeTruthy();
    expect(screen.queryByText("Synthetic 201")).toBeNull();
    expect(screen.queryByRole("link", { name: "PREVIOUS" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "NEXT" })[0].getAttribute("href")).toBe("/clients?page=2");
  });

  it("pages to the remaining clients and keeps the search in the links", async () => {
    render(await ClientsPage({ searchParams: Promise.resolve({ search: "Synthetic", page: "2" }) }));

    expect(browseCalls()).toEqual([{ search_text: "Synthetic", potential_category: null, exclude_unvisited_leads: true, page_offset: 200, result_limit: 200 }]);
    expect(screen.getAllByText("SHOWING CLIENTS 201-205 OF 205")).toHaveLength(2);
    expect(screen.getAllByText("PAGE 2 OF 2")).toHaveLength(2);
    expect(screen.getByText("Synthetic 205")).toBeTruthy();
    expect(screen.queryByText("Synthetic Lead")).toBeNull();
    expect(screen.queryByRole("link", { name: "NEXT" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "PREVIOUS" })[0].getAttribute("href")).toBe("/clients?search=Synthetic");
  });

  it("still shows the total on a page past the last one", async () => {
    render(await ClientsPage({ searchParams: Promise.resolve({ page: "9" }) }));

    expect(browseCalls()).toEqual([
      expect.objectContaining({ page_offset: 1600, result_limit: 200 }),
      expect.objectContaining({ page_offset: 0, result_limit: 1 }),
    ]);
    expect(screen.getByText("206 RESULT(S) FOUND.")).toBeTruthy();
    expect(screen.getAllByText("NO CLIENTS ON THIS PAGE.")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "PREVIOUS" })[0].getAttribute("href")).toBe("/clients?page=2");
  });

  it("treats a missing or invalid page number as page 1", async () => {
    render(await ClientsPage({ searchParams: Promise.resolve({ page: "abc" }) }));

    expect(browseCalls()[0]).toEqual(expect.objectContaining({ page_offset: 0 }));
  });
});
