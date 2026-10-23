// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduleFields, type CalendarTiming } from "./ScheduleFields";

afterEach(cleanup);

function Builder() {
  const [timing, setTiming] = useState<CalendarTiming>({ type: "calendar", startsOn: "2030-11-01", spec: { pattern: "daily", interval: 1, end: { type: "never" } } });
  return <ScheduleFields timing={timing} onTiming={setTiming} startTime="11:00" dueTime="18:00" onStartTime={() => {}} onDueTime={() => {}} assigneeNames={["Asha"]} isNew />;
}

describe("simple repeat choices", () => {
  it("anchors weekly and quarterly choices to the start date, including after changing it", () => {
    render(<Builder />);
    const repeats = screen.getByRole("combobox", { name: "Repeats" });
    fireEvent.change(repeats, { target: { value: "weekly" } });
    expect(screen.getByTestId("schedule-preview").textContent).toContain("Friday");
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2030-11-04" } });
    expect(screen.getByTestId("schedule-preview").textContent).toContain("Monday");
    fireEvent.change(repeats, { target: { value: "quarterly" } });
    expect(screen.getByTestId("schedule-preview").textContent).toContain("Every 3 months on the 4th");
    expect(screen.getByTestId("schedule-preview-dates").textContent).toContain("4 Feb, 2031");
  });

  it("offers annual recurrence and an optional custom monthly weekday pattern", () => {
    render(<Builder />);
    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "yearly" } });
    expect(screen.getByTestId("schedule-preview-dates").textContent).toContain("1 Nov, 2031");
    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "monthly_weekday" } });
    fireEvent.change(screen.getByLabelText("Which"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Weekday"), { target: { value: "SA" } });
    expect(screen.getByTestId("schedule-preview-dates").textContent).toContain("16 Nov, 2030");
  });
});
