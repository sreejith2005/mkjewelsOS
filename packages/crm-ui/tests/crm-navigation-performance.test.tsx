// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CrmAppRouter } from "@/crm-port/app-router";
import Link from "@/next-shim/link";

const mocks = vi.hoisted(() => ({ dashboardModule: vi.fn(), clientsModule: vi.fn(), dashboard: vi.fn(), clients: vi.fn() }));
vi.mock("@/app/(crm)/dashboard/page", () => { mocks.dashboardModule(); return { default: mocks.dashboard }; });
vi.mock("@/app/(crm)/clients/page", () => { mocks.clientsModule(); return { default: mocks.clients }; });
vi.mock("@/app/(crm)/layout", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/crm-port/use-crm-refresh", () => ({ useCrmRefresh: () => {} }));
afterEach(cleanup);

it("loads only the requested section and preloads menu code without fetching its records", async () => {
  mocks.dashboard.mockResolvedValue(<><h1>Dashboard</h1><Link href="/clients">Clients</Link><Link href="/clients" prefetch={false}>No prefetch</Link></>);
  mocks.clients.mockResolvedValue(<h1>Clients page</h1>);
  expect(mocks.dashboardModule).not.toHaveBeenCalled();
  expect(mocks.clientsModule).not.toHaveBeenCalled();
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><CrmAppRouter browserPath="/crm/dashboard" browserSearch="" /></QueryClientProvider>);
  await screen.findByRole("heading", { name: "Dashboard" });
  expect(mocks.dashboardModule).toHaveBeenCalledOnce();
  expect(mocks.clientsModule).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByText("No prefetch"));
  await act(async () => {});
  expect(mocks.clientsModule).not.toHaveBeenCalled();
  fireEvent.touchStart(screen.getByText("Clients"));
  await waitFor(() => expect(mocks.clientsModule).toHaveBeenCalledOnce());
  expect(mocks.clients).not.toHaveBeenCalled();
  view.rerender(<QueryClientProvider client={client}><CrmAppRouter browserPath="/crm/clients" browserSearch="" /></QueryClientProvider>);
  await screen.findByRole("heading", { name: "Clients page" });
  expect(mocks.clients).toHaveBeenCalledOnce();
});
