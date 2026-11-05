// @vitest-environment jsdom
// Fast CRM navigation (owner 2026-11-05): a page preloaded on hover/focus/touch is opened from the
// preload; the tab of the page being opened is known at once; a refresh never uses a preload.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CrmAppRouter } from "@/crm-port/app-router";
import { useCrmNavigation } from "@/crm-port/navigation-context";

const mocks = vi.hoisted(() => ({ load: vi.fn(), router: undefined as undefined | { preload: (href: string) => void }, pending: [] as (string | null)[] }));
vi.mock("@/app/(crm)/dashboard/page", () => ({ default: (props: { searchParams: Promise<Record<string, string>> }) => mocks.load(props) }));
vi.mock("@/app/(crm)/layout", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/crm-port/use-crm-refresh", () => ({ useCrmRefresh: () => undefined }));
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.pending = []; });

function Probe({ label }: { label: string }) {
  const navigation = useCrmNavigation();
  mocks.router = navigation.router;
  mocks.pending.push(navigation.pendingHref);
  return <p>{label}</p>;
}
const tree = (search: string) => <QueryClientProvider client={new QueryClient()}><CrmAppRouter browserPath="/crm/dashboard" browserSearch={search} /></QueryClientProvider>;

it("opens a preloaded page without loading it again", async () => {
  mocks.load.mockImplementation(async ({ searchParams }: { searchParams: Promise<Record<string, string>> }) => <Probe label={`view ${(await searchParams).tab ?? "first"}`} />);
  const { rerender } = render(tree(""));
  await waitFor(() => expect(screen.getByText("view first")).toBeTruthy());
  act(() => mocks.router?.preload("/dashboard?tab=next"));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  rerender(tree("?tab=next"));
  await waitFor(() => expect(screen.getByText("view next")).toBeTruthy());
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

it("names the page being opened while it loads", async () => {
  let release: (node: unknown) => void = () => undefined;
  mocks.load.mockResolvedValueOnce(<Probe label="first" />).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const { rerender } = render(tree(""));
  await waitFor(() => expect(screen.getByText("first")).toBeTruthy());
  rerender(tree("?tab=slow"));
  await waitFor(() => expect(mocks.pending.at(-1)).toBe("/dashboard?tab=slow"));
  await act(async () => { release(<Probe label="slow" />); });
  await waitFor(() => expect(screen.getByText("slow")).toBeTruthy());
  expect(mocks.pending.at(-1)).toBeNull();
});
