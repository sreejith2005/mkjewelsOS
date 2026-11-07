import { describe, expect, it } from "vitest";
import {
  assignmentLookupPayload,
  parseAssignmentLocations,
  parseAssignmentRecipientPage,
  parseBranchCounts,
  parseFranchiseModuleCoverage,
  parseOrgAuditHistory,
} from "./crossLocation";
import { departmentsForStore, userFormLocationChoices, type MyOrgScope } from "./franchiseScope";
import { normalizeFormDefinition } from "../forms/definition";

describe("cross-location lookup payloads", () => {
  it("names the saved question for a form and nothing else for a task", () => {
    expect(assignmentLookupPayload({ kind: "form", formTemplateId: "f1", fieldKey: "assign_to" })).toEqual({ kind: "form", form_template_id: "f1", field_key: "assign_to" });
    expect(assignmentLookupPayload({ kind: "task" })).toEqual({ kind: "task" });
  });
});

describe("parseAssignmentLocations", () => {
  it("keeps franchises with stores, an unmapped group, and the person's own location", () => {
    const parsed = parseAssignmentLocations({
      own_branch_id: "bandra", own_franchise_group_id: "mum",
      franchises: [
        { id: "ahd", name: "Ahmedabad", branches: [{ id: "a1", name: "Ahmedabad 1" }, { id: "a2", name: "Ahmedabad 2" }] },
        { id: "mum", name: "Mumbai", branches: [{ id: "bandra", name: "Bandra" }] },
        { id: null, name: "Other locations", branches: [{ id: "x", name: "Expo" }] },
        { id: "empty", name: "Empty", branches: [] },
      ],
    });
    expect(parsed.ownBranchId).toBe("bandra");
    expect(parsed.locations.map((item) => item.name)).toEqual(["Ahmedabad", "Mumbai", "Other locations"]);
    expect(parsed.locations[2]!.id).toBeNull();
    expect(parsed.locations[0]!.stores).toHaveLength(2);
  });

  it("fails closed on malformed replies", () => {
    expect(parseAssignmentLocations(null).locations).toEqual([]);
    expect(parseAssignmentLocations({ franchises: [{ name: "No stores", branches: [{ id: 3 }] }] }).locations).toEqual([]);
  });
});

describe("parseAssignmentRecipientPage", () => {
  it("returns only id, name, designation and location; drops incomplete rows", () => {
    const page = parseAssignmentRecipientPage({
      has_more: true,
      rows: [
        { id: "u1", name: "Asha", designation: "Sales", branch_id: "a2", branch_name: "Ahmedabad 2", franchise_group_id: "ahd", franchise_name: "Ahmedabad", email: "leak@example.in" },
        { id: "u2", name: "", branch_id: "a2", branch_name: "Ahmedabad 2" },
      ],
    });
    expect(page.hasMore).toBe(true);
    expect(page.rows).toEqual([{ id: "u1", name: "Asha", designation: "Sales", storeId: "a2", storeName: "Ahmedabad 2", departmentId: null, franchiseId: "ahd", franchiseName: "Ahmedabad" }]);
    expect(page.rows[0]).not.toHaveProperty("email");
  });
});

describe("franchise panel payloads", () => {
  it("parses coverage, history and counts", () => {
    expect(parseFranchiseModuleCoverage([{ module: "tasks", label: "Tasks", status: "enforced" }, { module: "crm_clients", label: "CRM", status: "pending", pending_reason: "later" }]))
      .toEqual([{ module: "tasks", label: "Tasks", enforced: true, pendingReason: null }, { module: "crm_clients", label: "CRM", enforced: false, pendingReason: "later" }]);
    expect(parseOrgAuditHistory([{ id: "1", action: "org_scope_granted", created_at: "2026-11-06T10:00:00Z", actor_name: "Owner" }])[0]!.label).toBe("Scope granted");
    expect([...parseBranchCounts({ a: 3, b: -1, c: "x" })]).toEqual([["a", 3]]);
  });
});

const branches = [
  { id: "bandra", name: "Bandra", is_active: true, franchise_group_id: "mum" },
  { id: "andheri", name: "Andheri", is_active: true, franchise_group_id: "mum" },
  { id: "zaveri", name: "Zaveri Bazaar", is_active: true, franchise_group_id: "mum" },
  { id: "a1", name: "Ahmedabad 1", is_active: true, franchise_group_id: "ahd" },
  { id: "a2", name: "Ahmedabad 2", is_active: true, franchise_group_id: "ahd" },
  { id: "old", name: "Closed", is_active: false, franchise_group_id: "mum" },
  { id: "expo", name: "Expo", is_active: true, franchise_group_id: null },
];
const franchises = [{ id: "mum", name: "Mumbai", is_active: true }, { id: "ahd", name: "Ahmedabad", is_active: true }];
const scope = (patch: Partial<MyOrgScope>): MyOrgScope => ({
  enforcementEnabled: true, companyScope: false, branchId: "bandra", franchiseGroupId: "mum", authorities: [], readableBranchIds: [], manageableBranchIds: [], ...patch,
});

describe("userFormLocationChoices", () => {
  it("offers every franchise to company scope, with only that franchise's active stores", () => {
    const choices = userFormLocationChoices(branches, franchises, scope({ companyScope: true }));
    expect(choices.franchises.map((item) => item.name)).toEqual(["Ahmedabad", "Mumbai", "Not mapped yet"]);
    expect(choices.storesOf("mum").map((item) => item.name)).toEqual(["Andheri", "Bandra", "Zaveri Bazaar"]);
    expect(choices.storesOf("ahd").map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(choices.lockedFranchiseId).toBeUndefined();
  });

  it("locks a regional authority to their own franchise", () => {
    const choices = userFormLocationChoices(branches, franchises, scope({ manageableBranchIds: ["bandra", "andheri", "zaveri"] }));
    expect(choices.franchises).toEqual([{ id: "mum", name: "Mumbai" }]);
    expect(choices.lockedFranchiseId).toBe("mum");
  });

  it("gives a store manager exactly their store", () => {
    const choices = userFormLocationChoices(branches, franchises, scope({ manageableBranchIds: ["bandra"] }));
    expect(choices.storesOf("mum").map((item) => item.id)).toEqual(["bandra"]);
  });

  it("keeps today's choices while isolation is off", () => {
    const choices = userFormLocationChoices(branches, franchises, scope({ enforcementEnabled: false }));
    expect(choices.franchises).toHaveLength(3);
    expect(choices.lockedFranchiseId).toBeUndefined();
  });
});

describe("departmentsForStore", () => {
  it("lists the store's own and shared active departments", () => {
    const departments = [
      { id: "sales", branch_id: null, is_active: true },
      { id: "bandra_crm", branch_id: "bandra", is_active: true },
      { id: "andheri_crm", branch_id: "andheri", is_active: true },
      { id: "old", branch_id: null, is_active: false },
    ];
    expect(departmentsForStore(departments, "bandra").map((item) => item.id)).toEqual(["sales", "bandra_crm"]);
  });
});

describe("Users question location setting", () => {
  it("keeps 'other locations' only on Users questions", () => {
    const definition = normalizeFormDefinition({
      name: "Lead",
      fields: [
        { key: "assign_to", label: "Assign to", type: "user_dropdown", sortOrder: 0, assignmentScope: "cross_location" },
        { key: "note", label: "Note", type: "text", sortOrder: 1, assignmentScope: "cross_location" },
        { key: "local", label: "Local", type: "user_dropdown", sortOrder: 2 },
      ],
    });
    expect(definition.fields.map((field) => field.assignmentScope)).toEqual(["cross_location", undefined, undefined]);
  });
});
