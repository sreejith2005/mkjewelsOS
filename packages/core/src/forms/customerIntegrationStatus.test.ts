import { describe, expect, it } from "vitest";
import { CUSTOMER_SETUP_STATES, CUSTOMER_SYNC_STATES, crmRecordType, customerReasonText, customerSetupStatus, customerSyncStatus } from "./customerIntegrationStatus";

describe("customer integration status", () => {
  it("gives every setup and sync state a label", () => {
    for (const state of CUSTOMER_SETUP_STATES) expect(customerSetupStatus(state).label).not.toBe("Unknown");
    for (const state of CUSTOMER_SYNC_STATES) expect(customerSyncStatus(state).label).not.toBe("Unknown");
  });
  it("never reports an unconfigured form as healthy", () => {
    expect(customerSetupStatus("not_configured").tone).toBe("neutral");
    expect(customerSetupStatus("not_configured").action).toContain("Form Builder");
    expect(customerSetupStatus("active").action).toBeNull();
  });
  it("tells the administrator where approval happens", () => {
    expect(customerSetupStatus("awaiting_crm_approval").action).toContain("Customer Integration Administration");
    expect(customerSetupStatus("form_changed").tone).toBe("warning");
  });
  it("keeps pending sync neutral and failures visible", () => {
    expect(customerSyncStatus("queued").tone).toBe("pending");
    expect(customerSyncStatus("failed").tone).toBe("danger");
    expect(customerSyncStatus("whatever").label).toBe("Unknown");
  });
  it("explains reason codes without exposing values", () => {
    expect(customerReasonText("actor_or_branch_denied")).toContain("CRM access");
    expect(customerReasonText("mapping_http_503")).toBe("the CRM returned an error");
    expect(customerReasonText(null)).toBeNull();
  });
  it("classifies Lead and Client like the CRM browse rule", () => {
    expect(crmRecordType({ lifecycleStage: "lead", totalVisits: 0 })).toBe("lead");
    expect(crmRecordType({ lifecycleStage: "engaged", totalVisits: 0 })).toBe("lead");
    expect(crmRecordType({ lifecycleStage: "lead", totalVisits: 1 })).toBe("client");
    expect(crmRecordType({ lifecycleStage: "visited", totalVisits: 0 })).toBe("client");
  });
});
