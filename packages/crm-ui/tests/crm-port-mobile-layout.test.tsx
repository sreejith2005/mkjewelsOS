// @vitest-environment jsdom
// crm-port: phone layout (owner request 2026-10-07). Not an original test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CrmDocument, MOBILE_SCOPE, scopeMobileCss } from "@/crm-port/document";
import { labelTableCells } from "@/crm-port/mobile-tables";

// Vitest stubs CSS imports (even ?raw) to empty text, so the source is read from disk.
const mobileSource = readFileSync(join(process.cwd(), "src", "crm-port", "mobile.css"), "utf8");

afterEach(() => { cleanup(); document.head.querySelectorAll("style[data-crm-ui]").forEach((style) => style.remove()); });

function table(headings: string[], rows: string[][]) {
  const element = document.createElement("table");
  element.innerHTML = `<thead><tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => cell.startsWith("<td") ? cell : `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>`;
  const host = document.createElement("div");
  host.append(element);
  return { host, element };
}

describe("phone table cards", () => {
  it("labels every cell of a wide table with its column heading", () => {
    const { host, element } = table(["Type", "Client ID", "Name", "Phone"], [["CLIENT", "MKC-1", "Anita", "+91 90000 00000"]]);
    labelTableCells(host);
    expect(element.hasAttribute("data-crm-cards")).toBe(true);
    expect([...element.querySelectorAll("tbody td")].map((cell) => cell.getAttribute("data-label"))).toEqual(["Type", "Client ID", "Name", "Phone"]);
  });

  it("keeps short tables as tables and leaves empty-state rows unlabelled", () => {
    const short = table(["Name", "Count"], [["Andheri", "4"]]);
    labelTableCells(short.host);
    expect(short.element.hasAttribute("data-crm-cards")).toBe(false);
    expect(short.element.querySelector("td")?.hasAttribute("data-label")).toBe(false);

    const empty = table(["A", "B", "C", "D"], [['<td colspan="4">NO VISITS FOUND.</td>']]);
    labelTableCells(empty.host);
    expect(empty.element.hasAttribute("data-crm-cards")).toBe(true);
    expect(empty.element.querySelector("td")?.hasAttribute("data-label")).toBe(false);
  });

  it("labels rows rendered after the CRM mounts", async () => {
    const { container } = render(<CrmDocument title="MK Jewels CRM"><table><thead><tr><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody /></table></CrmDocument>);
    const row = document.createElement("tr");
    row.innerHTML = "<td>1</td><td>2</td><td>3</td><td>4</td>";
    container.querySelector("tbody")!.append(row);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(row.lastElementChild?.getAttribute("data-label")).toBe("D");
  });
});

describe("phone stylesheet", () => {
  it("applies only at phone width and is scoped above the original stylesheet", () => {
    // Every rule is inside a max-width media query, so tablets and desktops are unchanged.
    const outside = mobileSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").trim();
    expect(outside).toBe("");
    expect([...mobileSource.matchAll(/@media\s*\(([^)]*)\)/g)].every(([, query]) => /^max-width:\s*\d+px$/.test(query!.trim()))).toBe(true);
    // One id more than the original's strongest tier (.crm-root + four #crm-root).
    expect(MOBILE_SCOPE).toBe(".crm-root#crm-root#crm-root#crm-root#crm-root#crm-root");
    const css = scopeMobileCss(mobileSource);
    expect(css).not.toContain("#crm-mobile");
    expect(css).toContain(`${MOBILE_SCOPE} .crm-app table[data-crm-cards]`);
  });

  it("is attached as the single CRM style element while mounted", () => {
    const view = render(<CrmDocument title="MK Jewels CRM"><p>CRM</p></CrmDocument>);
    expect(document.querySelectorAll("style[data-crm-ui]").length).toBe(1);
    view.unmount();
    expect(document.querySelectorAll("style[data-crm-ui]").length).toBe(0);
  });
});
