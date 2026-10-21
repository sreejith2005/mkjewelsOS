// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { newFmsStage } from "./definition";
import { FmsTaskNaming } from "./FmsTaskNaming";
afterEach(cleanup);
it("selects an actual pinned question without requiring a technical template", async () => {
 const stage = { ...newFmsStage("form", 0), key: "initial", formTemplateId: "pinned" }; const change = vi.fn();
 render(<FmsTaskNaming stage={stage} stages={[stage]} fields={{ pinned: [{ key: "customer_name", label: "Customer Name", type: "text" }, { key: "password", label: "Password", type: "text" }, { key: "notes", label: "Notes", type: "textarea" }] }} onChange={change} />);
 expect(screen.queryByRole("option", { name: /Password|Notes/ })).toBeNull();
 await userEvent.selectOptions(screen.getByRole("combobox", { name: "Task name from" }), "initial:customer_name");
 expect(change).toHaveBeenCalledWith(expect.objectContaining({ sla: expect.objectContaining({ taskDisplay: expect.objectContaining({ recordNaming: { mode: "field", source: { sourceStageKey: "initial", formTemplateId: "pinned", fieldKey: "customer_name" } } }) }) }));
});
