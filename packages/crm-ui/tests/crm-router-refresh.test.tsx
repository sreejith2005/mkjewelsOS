// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CrmAppRouter } from "@/crm-port/app-router";
import { useRouter } from "@/next-shim/navigation";

const mocks = vi.hoisted(() => ({ load: vi.fn(), refresh: undefined as (() => Promise<void>) | undefined }));
vi.mock("@/app/(crm)/dashboard/page", () => ({ default: () => mocks.load() }));
vi.mock("@/app/(crm)/layout", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/crm-port/use-crm-refresh", () => ({ useCrmRefresh: (refresh: () => Promise<void>) => { mocks.refresh = refresh; } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.refresh = undefined; });

function Editor({ committed }: { committed: string }) {
  const [draft, setDraft] = useState("");
  const router = useRouter();
  return <><output>{committed}</output><input aria-label="Client draft" onChange={(event) => setDraft(event.target.value)} value={draft} /><button onClick={() => router.refresh()}>Manual refresh</button></>;
}
function open() {
  return render(<QueryClientProvider client={new QueryClient()}><CrmAppRouter browserPath="/crm/dashboard" browserSearch="" /></QueryClientProvider>);
}
async function refresh() {
  expect(mocks.refresh).toBeDefined();
  let done: Promise<void> | undefined;
  act(() => { done = mocks.refresh?.(); });
  await act(async () => { await done; });
}

it("reconciles committed remote values without resetting an unsaved editor", async () => {
  mocks.load.mockResolvedValueOnce(<Editor committed="Before" />).mockResolvedValue(<Editor committed="After" />);
  open();
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Client draft"), { target: { value: "Unsaved changes" } });
  await refresh();
  expect(screen.queryByText("After")).not.toBeNull();
  expect((screen.getByLabelText("Client draft") as HTMLInputElement).value).toBe("Unsaved changes");
});

it("retains the current editor after a background failure and recovers on retry", async () => {
  mocks.load.mockResolvedValueOnce(<Editor committed="Before" />).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue(<Editor committed="After" />);
  open();
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Client draft"), { target: { value: "Keep this draft" } });
  await refresh();
  expect(screen.queryByRole("alert")).not.toBeNull();
  expect((screen.getByLabelText("Client draft") as HTMLInputElement).value).toBe("Keep this draft");
  await refresh();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("After")).not.toBeNull();
  expect((screen.getByLabelText("Client draft") as HTMLInputElement).value).toBe("Keep this draft");
});

it("resolves refresh only after the current route loader finishes", async () => {
  let finish: ((value: React.ReactNode) => void) | undefined;
  mocks.load.mockResolvedValueOnce(<Editor committed="Before" />)
    .mockImplementationOnce(() => new Promise<React.ReactNode>((resolve) => { finish = resolve; }));
  open();
  await act(async () => {});
  let settled = false;
  let done: Promise<void> | undefined;
  act(() => { done = mocks.refresh?.().then(() => { settled = true; }); });
  await act(async () => {});
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(settled).toBe(false);
  await act(async () => { finish?.(<Editor committed="After" />); await done; });
  expect(settled).toBe(true);
  expect(screen.queryByText("After")).not.toBeNull();
});

it("keeps refresh pending when an obsolete loader finishes before its replacement", async () => {
  let finishOld: ((value: React.ReactNode) => void) | undefined;
  let finishCurrent: ((value: React.ReactNode) => void) | undefined;
  mocks.load.mockResolvedValueOnce(<Editor committed="Before" />)
    .mockImplementationOnce(() => new Promise<React.ReactNode>((resolve) => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise<React.ReactNode>((resolve) => { finishCurrent = resolve; }));
  open();
  await act(async () => {});
  let settled = false;
  let done: Promise<void> | undefined;
  act(() => { done = mocks.refresh?.().then(() => { settled = true; }); });
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Manual refresh" }));
  await act(async () => {});
  await act(async () => { finishOld?.(<Editor committed="Obsolete" />); });
  expect(settled).toBe(false);
  await act(async () => { finishCurrent?.(<Editor committed="Current" />); await done; });
  expect(settled).toBe(true);
  expect(screen.queryByText("Current")).not.toBeNull();
  expect(screen.queryByText("Obsolete")).toBeNull();
});
