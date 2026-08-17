// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { FmsStageDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { newFmsStage } from "./definition";
import { FmsStageEditor } from "./FmsStageEditor";

const data: FmsData = {
  flows: [], stages: [], assignees: [], branchRules: [], forms: [{ id: "00000000-0000-4000-8000-000000000001", name: "Initial details", version: 1 }], availability: [],
  branches: [{ id: "b1", name: "Main" }],
  departments: [{ id: "d1", branch_id: null, name: "Sales" }],
  users: [
    { id: "u1", employee_name: "Primary Person", employee_code: "EMP-1", account_status: "active", user_role: "staff", branch_id: "b1", department_id: "d1", working_status: "active", is_login_enabled: true },
    { id: "u2", employee_name: "Fallback Person", employee_code: "EMP-2", account_status: "invited", user_role: "staff", branch_id: "b2", department_id: "d1", working_status: "active", is_login_enabled: false },
  ],
};

afterEach(cleanup);

function Harness() {
  const [stage, setStage] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("task", 0), key: "task" }));
  return <FmsStageEditor data={data} flowBranchId="b1" onChange={setStage} onDelete={() => undefined} stage={stage} stages={[stage]} />;
}

function LaterFormHarness() {
  const first = { ...newFmsStage("form", 0), key: "initial", formTemplateId: data.forms[0]!.id };
  const [later, setLater] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("form", 1), key: "later" }));
  return <FmsStageEditor data={data} flowBranchId="b1" onChange={setLater} onDelete={() => undefined} stage={later} stages={[first, later]} />;
}

describe("FMS stage assignment", () => {
  it("keeps the department selected and exposes primary and same-department fallback people", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(screen.getByLabelText("Department"), "d1");
    expect(screen.getByText("2 people available from Users for this department.")).toBeTruthy();

    const primary = screen.getByLabelText("Primary assignee");
    expect(primary.textContent).toContain("Primary Person");
    expect(primary.textContent).toContain("Fallback Person");
    await user.selectOptions(primary, "u1");

    const fallback = screen.getByLabelText("Fallback assignee");
    expect(fallback.textContent).toContain("Fallback Person");
    expect(fallback.textContent).not.toContain("Primary Person");
  });
  it("uses one calendar deadline field and no minute inputs", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Completion due date").getAttribute("type")).toBe("date");
    expect(screen.queryByLabelText("SLA minutes")).toBeNull();
    expect(screen.queryByLabelText("Escalate after")).toBeNull();
  });
  it("requires the initial details form but keeps every later form attachment optional", async () => {
    const user = userEvent.setup();
    render(<LaterFormHarness />);
    expect(screen.queryByLabelText("Initial details form")).toBeNull();
    expect(screen.queryByLabelText("Optional linked form")).toBeNull();
    await user.click(screen.getByLabelText("Attach an optional form"));
    expect(screen.getByLabelText("Optional linked form")).toBeTruthy();
  });
});
