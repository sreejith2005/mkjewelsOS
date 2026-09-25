// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn().mockResolvedValue({ data: [] });
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module

import { ClientSearch } from "@/components/client-search";

afterEach(() => vi.restoreAllMocks());

describe("ClientSearch", () => {
  it("does not warn when crossing search thresholds or typing rapidly", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ClientSearch />);
    const input = screen.getByLabelText("Search client");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.change(input, { target: { value: "abcd" } });
    fireEvent.change(input, { target: { value: "abcde" } });
    expect(error.mock.calls.flat().join(" ")).not.toContain("The final argument passed to useEffect changed size");
  });
});
