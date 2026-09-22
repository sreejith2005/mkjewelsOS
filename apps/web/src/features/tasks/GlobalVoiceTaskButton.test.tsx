// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types";

vi.mock("./GlobalVoiceTaskComposer", () => ({
  GlobalVoiceTaskComposer: ({ onClose, onReady }: { onClose: () => void; onReady: () => void }) => (
    <div data-testid="voice-composer">
      <button onClick={onReady} type="button">ready</button>
      <button onClick={onClose} type="button">close</button>
    </div>
  ),
}));

const { GlobalVoiceTaskButton } = await import("./GlobalVoiceTaskButton");
const profile = { id: "p1", tenant_id: "t1" } as UserProfile;

afterEach(cleanup);

describe("GlobalVoiceTaskButton", () => {
  it("opens the task composer and returns to the button when it closes", async () => {
    render(<GlobalVoiceTaskButton profile={profile} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Assign a task by voice" })); });
    expect(await screen.findByTestId("voice-composer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign a task by voice" })).toBeNull();
    expect(screen.getByRole("status", { name: "Opening voice task" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ready" }));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByTestId("voice-composer")).toBeNull();
    expect(screen.getByRole("button", { name: "Assign a task by voice" })).toBeTruthy();
  });

  it("sits above the Tasks page Create Task button when raised", () => {
    const { container, rerender } = render(<GlobalVoiceTaskButton profile={profile} />);
    expect(container.firstElementChild?.className).toContain("md:bottom-8");
    rerender(<GlobalVoiceTaskButton profile={profile} raised />);
    expect(container.firstElementChild?.className).toContain("md:bottom-28");
  });
});
