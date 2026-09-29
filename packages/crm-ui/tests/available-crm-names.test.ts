import { describe, expect, it } from "vitest";

import { availableCrmNames } from "@/lib/available-crm-names";

describe("entry-queue assigned-CRM dropdown", () => {
  it("excludes an explicitly unavailable CRM for today without excluding them on another date", () => {
    const roster = [{ crm_name: "Available CRM" }, { crm_name: "Unavailable CRM" }];
    const todaysExceptions = [{ crm_name: "Unavailable CRM", is_available: false }];

    expect(availableCrmNames(roster, todaysExceptions)).toEqual(["AVAILABLE CRM"]);
    expect(availableCrmNames(roster, [])).toEqual(["AVAILABLE CRM", "UNAVAILABLE CRM"]);
  });

  it("uses the legacy uppercase, trimmed, single-space comparison for roster names", () => {
    expect(availableCrmNames([{ crm_name: "  Anu   Shah " }, { crm_name: "ANU SHAH" }], [{ crm_name: "anu shah", is_available: false }])).toEqual([]);
  });
});
