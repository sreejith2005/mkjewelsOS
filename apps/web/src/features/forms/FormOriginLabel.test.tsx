// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormOriginLabel } from "./FormOriginLabel";
afterEach(cleanup);
describe("form creation source", () => {
  it("keeps Forms Library origin when a regular form is used in FMS", () => {
    render(<FormOriginLabel provenance={{ origin: "library", family_id: "f", created_at: "now", used_in_fms: true }} />);
    expect(screen.getByText("Origin: Forms Library")).toBeTruthy();
    expect(screen.queryByText("Origin: Created in FMS")).toBeNull();
  });
  it("shows source deletion without inventing a link", () => {
    render(<FormOriginLabel provenance={{ origin: "fms", family_id: "f", created_at: "now", source_deleted: true }} />);
    expect(screen.getByText("Originally created in FMS — source workflow no longer available.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
