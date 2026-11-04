// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesRecordingPage } from "./SalesRecordingPage";
import { cleanup } from "@testing-library/react";
import { listRecordingSessions, recordingSnapshot } from "@jewelos/data";

const capture = vi.hoisted(() => ({ state: { session: null as { id: string; employee_id: string } | null, state: "idle", level: 0, elapsedMs: 0, queuedBytes: 0, network: "connected", error: null } }));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "employee" }, access: null }) }));
vi.mock("@jewelos/data", () => ({ listRecordingSessions: vi.fn(async () => []), recordingSnapshot: vi.fn(), startRecordingSession: vi.fn(), renewRecordingTicket: vi.fn(), controlRecordingSession: vi.fn() }));
vi.mock("@/features/recording/browserRecorder", () => {
  return { webCaptureSupported: () => false, browserRecorder: () => ({ subscribe: () => () => {}, snapshot: () => capture.state }) };
});
afterEach(() => { cleanup(); capture.state.session = null; capture.state.state = "idle"; vi.mocked(listRecordingSessions).mockResolvedValue([]); });
describe("Sales Recording screen", () => {
  it("requires permission and consent, and explains browser closure limits before microphone use", async () => {
    render(<SalesRecordingPage />);
    expect(screen.getByRole("heading", { name: "Sales Recording" })).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(start.disabled).toBe(true);
    expect(screen.getByText(/does not continue after closing this tab/)).toBeTruthy();
    expect(screen.getByText(/cannot safely record here/)).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Audio input" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No recordings loaded.")).toBeTruthy());
  });
  it("keeps live Pause and Stop available while a different historical transcript is selected", async () => {
    capture.state.session = { id: "active", employee_id: "employee" }; capture.state.state = "recording";
    const historical = { id: "historical", employee_id: "someone-else", device_id: "d", branch_id: "b", tenant_id: "t", status: "ready" as const, next_sequence: 1, created_at: "2026-11-04T00:00:00Z", error_reason: null };
    vi.mocked(listRecordingSessions).mockResolvedValue([historical]);
    vi.mocked(recordingSnapshot).mockResolvedValue({ session: historical, segments: [], alerts: [] });
    render(<SalesRecordingPage />);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Recording session" }) as HTMLSelectElement).value).toBe("historical"));
    expect((screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Recording", { exact: true })).toBeTruthy();
  });
});
