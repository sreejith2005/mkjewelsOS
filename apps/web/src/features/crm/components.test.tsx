import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClientForm } from "./ClientForm";
import { CrmDirectory, EMPTY_FILTERS } from "./CrmDirectory";
import { WalkinForm } from "./WalkinForm";
import { WalkinWorkspace } from "./WalkinWorkspace";
import type { CrmClientSummary, CrmOptions } from "./types";

const options: CrmOptions = {
  branches: [{ id: "2c120000-0000-0000-0000-000000000001", label: "Synthetic Branch" }],
  profiles: [{ id: "4c120000-0000-0000-0000-000000000001", label: "Synthetic CRM", branch_id: "2c120000-0000-0000-0000-000000000001", user_role: "crm" }],
  dropdowns: [],
};

const client: CrmClientSummary = {
  id: "7c120000-0000-0000-0000-000000000001",
  first_name: "Synthetic",
  last_name: "Client",
  phone: "+919876543210",
  email: "client@example.invalid",
  branch_id: options.branches[0]!.id,
  assigned_crm_id: options.profiles[0]!.id,
  client_type_id: null,
  source_id: null,
  potential_category: null,
  total_visits: 2,
  last_visit_date: "2026-08-09",
  next_visit_date: "2026-08-11",
  record_version: 1,
  updated_at: "2026-08-10T00:00:00Z",
  next_cursor: "synthetic-cursor",
};

const directory = (overrides: Partial<Parameters<typeof CrmDirectory>[0]> = {}) => renderToStaticMarkup(<CrmDirectory
  error={null}
  filters={EMPTY_FILTERS}
  hasMore={false}
  items={[]}
  loading={false}
  onFilters={vi.fn()}
  onMore={vi.fn()}
  onOpen={vi.fn()}
  options={options}
  {...overrides}
/>);

describe("CRM component states", () => {
  it("renders an accessible loading state", () => expect(directory({ loading: true })).toContain('aria-label="Loading clients"'));
  it("renders the authorized empty state", () => expect(directory()).toContain("No authorized clients found"));
  it("renders errors as alerts", () => expect(directory({ error: "Synthetic request failed" })).toContain('role="alert"'));
  it("renders responsive client cards and follow-up state", () => {
    const html = directory({ items: [client], hasMore: true });
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("Follow-up 2026-08-11");
    expect(html).toContain("Load more");
  });
  it("renders labelled client profile, assignment, and consent controls", () => {
    const html = renderToStaticMarkup(<ClientForm onCancel={vi.fn()} onSaved={vi.fn()} options={options}/>);
    expect(html).toContain("Primary phone");
    expect(html).toContain("Home branch");
    expect(html).toContain("Assigned CRM");
    expect(html).toContain("recorded communication consent");
  });
  it("renders the phone-first walk-in and private attachment controls", () => {
    const html = renderToStaticMarkup(<WalkinForm onCancel={vi.fn()} onSaved={vi.fn()} options={options}/>);
    expect(html).toContain("Look up");
    expect(html).toContain("Visit date and time");
    expect(html).toContain("Optional private attachment");
    expect(html).toContain("Record walk-in");
  });
  it("renders the native walk-in CRM workspace instead of an external destination", () => {
    const html = renderToStaticMarkup(<WalkinWorkspace onCompleted={vi.fn()} options={options}/>);
    expect(html).toContain("CLIENT WALK-IN FORM");
    expect(html).toContain("Register a client visit inside JewelOS");
    expect(html).toContain("NEW WALK-IN");
    expect(html).toContain("RETURNING CLIENT");
  });
});
