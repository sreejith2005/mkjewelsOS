// Opening CRM from JewelOS lands on CLIENT QUEUE (owner request 2026-11-04): the queue itself, no chooser.
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";
import { CrmRedirect } from "@/crm-port/runtime";

describe("CRM landing page", () => {
  it("sends /crm to the client queue", () => {
    let thrown: unknown;
    try { HomePage(); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(CrmRedirect);
    expect((thrown as CrmRedirect).path).toBe("/queue");
  });
});
