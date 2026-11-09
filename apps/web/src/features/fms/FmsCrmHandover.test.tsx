// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FmsCrmHandover } from "./FmsCrmHandover";

const api = vi.hoisted(() => ({ list: vi.fn(), handOver: vi.fn() }));
vi.mock("./api", () => ({ listFmsHandoverCandidates: api.list, handOverFmsStep: api.handOver }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("renders nothing when the server offers nobody (not a CRM task, or not yours)", async () => {
  api.list.mockResolvedValue([]);
  const { container } = render(<FmsCrmHandover instanceStageId="stage-1" onDone={vi.fn()} />);
  await waitFor(() => expect(api.list).toHaveBeenCalledWith("stage-1"));
  expect(container.textContent).toBe("");
});

it("hands the task to another CRM with a one-tap reason", async () => {
  api.list.mockResolvedValue([
    { id: "crm-2", employee_name: "Asha (CRM)", team: "crm", branch_id: null },
    { id: "sales-1", employee_name: "Ravi (Sales)", team: "sales", branch_id: "b1" },
  ]);
  api.handOver.mockResolvedValue(undefined);
  const onDone = vi.fn().mockResolvedValue(undefined);
  render(<FmsCrmHandover instanceStageId="stage-1" onDone={onDone} />);
  fireEvent.click(await screen.findByRole("button", { name: "Hand over" }));
  expect(screen.getByText("CRM team")).toBeTruthy();
  expect(screen.getByText("Salespeople")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Choose a person" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Asha (CRM)" }));
  fireEvent.click(screen.getByRole("button", { name: "I did not attend this client" }));
  fireEvent.click(screen.getByRole("button", { name: "Hand over to Asha (CRM)" }));
  await waitFor(() => expect(api.handOver).toHaveBeenCalledWith("stage-1", "crm-2", "I did not attend this client"));
  expect(await screen.findByText("Handed over to Asha (CRM). It is now in their task list.")).toBeTruthy();
  expect(onDone).toHaveBeenCalled();
});

it("shows the server's reason when the hand-over is refused", async () => {
  api.list.mockResolvedValue([{ id: "crm-2", employee_name: "Asha", team: "crm", branch_id: null }]);
  api.handOver.mockRejectedValue(new Error("This person already has this task"));
  render(<FmsCrmHandover instanceStageId="stage-1" onDone={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Hand over" }));
  fireEvent.click(screen.getByRole("button", { name: "Asha" }));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Busy" } });
  fireEvent.click(screen.getByRole("button", { name: "Hand over to Asha" }));
  expect(await screen.findByText("This person already has this task")).toBeTruthy();
});
