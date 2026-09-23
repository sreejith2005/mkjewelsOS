// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  addTaskComment: vi.fn<(taskId: string, comment: string) => Promise<string>>(),
  loadTaskComments: vi.fn(),
}));
vi.mock("@jewelos/data/tasks/comments", () => ({ ...api, TASK_COMMENT_MAX_LENGTH: 1000 }));

import { TaskRemarks } from "./TaskRemarks";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TaskRemarks", () => {
  it("shows the empty state, then sends a remark and reloads the thread", async () => {
    api.loadTaskComments.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "c1", comment: "Please share the price range", createdAt: "2026-09-23T09:30:00.000Z", authorId: "u2", authorName: "Watcher" },
    ]);
    api.addTaskComment.mockResolvedValue("c1");

    await act(async () => { render(<TaskRemarks taskId="task-1" />); });
    expect(screen.getByText(/No remarks yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send remark" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: "Add your comment" }), { target: { value: "Please share the price range" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send remark" })); });

    expect(api.addTaskComment).toHaveBeenCalledWith("task-1", "Please share the price range");
    expect(screen.getByText("Please share the price range")).toBeTruthy();
    expect(screen.getByText("Watcher")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Add your comment" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("surfaces a server refusal without losing the draft", async () => {
    api.loadTaskComments.mockResolvedValue([]);
    api.addTaskComment.mockRejectedValue(new Error("Add remark: Task remark denied"));

    await act(async () => { render(<TaskRemarks taskId="task-1" />); });
    fireEvent.change(screen.getByRole("textbox", { name: "Add your comment" }), { target: { value: "Hello" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send remark" })); });

    expect(screen.getByText("Add remark: Task remark denied")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Add your comment" }) as HTMLTextAreaElement).value).toBe("Hello");
  });
});
