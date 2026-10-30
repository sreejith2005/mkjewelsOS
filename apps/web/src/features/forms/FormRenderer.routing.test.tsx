// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { FormTemplateDefinition } from "@jewelos/core";
import { FormRenderer } from "./FormRenderer";
afterEach(cleanup);
const definition: FormTemplateDefinition = { name: "Conditional call", sections: [
  { key: "start", title: "Start", next: "__submit__" },
  { key: "follow", title: "Interested Follow-up", visibility: "when", rule: { kind: "predicate", fieldKey: "status", operator: "equals", value: "interested" } },
  { key: "retry", title: "Call Not Connected", visibility: "when", rule: { kind: "predicate", fieldKey: "status", operator: "equals", value: "retry" } },
], fields: [
  { key: "status", label: "Status", type: "radio", required: true, sortOrder: 0, sectionKey: "start", options: [{ value: "interested", label: "Interested" }, { value: "retry", label: "Call Not Connected" }], branches: [
    { operator: "equals", rule: { kind: "predicate", fieldKey: "status", operator: "equals", value: "interested" }, targetSectionKey: "follow" },
    { operator: "equals", rule: { kind: "predicate", fieldKey: "status", operator: "equals", value: "retry" }, targetSectionKey: "retry" },
  ] },
  { key: "appointment", label: "Appointment details", type: "text", sortOrder: 1, sectionKey: "follow", required: true },
  { key: "remark", label: "Retry remark", type: "text", sortOrder: 2, sectionKey: "retry", required: true },
] };
it("recalculates short-form routing on Back and submits only the changed active path", async () => {
  const user = userEvent.setup(); const submit = vi.fn(async () => undefined);
  render(<FormRenderer definition={definition} onSubmit={submit} />);
  await user.click(screen.getByRole("radio", { name: "Interested" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: /Appointment details/ }), "Old appointment");
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("radio", { name: "Call Not Connected" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("textbox", { name: /Appointment details/ })).toBeNull();
  await user.type(screen.getByRole("textbox", { name: /Retry remark/ }), "Try tomorrow");
  await user.click(screen.getByRole("button", { name: "Submit form" }));
  expect(submit).toHaveBeenCalledExactlyOnceWith({ status: "retry", remark: "Try tomorrow" });
});
it("runs the same path in preview and never submits or progresses a workflow", async () => {
  const user = userEvent.setup(); const submit = vi.fn(async () => undefined);
  render(<FormRenderer definition={definition} onSubmit={submit} preview />);
  await user.click(screen.getByRole("radio", { name: "Interested" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: /Appointment details/ }), "Sample");
  await user.click(screen.getByRole("button", { name: /Test validation/ }));
  expect(submit).not.toHaveBeenCalled();
});
