// @vitest-environment jsdom
// crm-port: phone layout (owner request 2026-10-07). Not an original test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CrmDocument, MOBILE_SCOPE, scopeMobileCss } from "@/crm-port/document";
import { fitListingHeights, labelTableCells } from "@/crm-port/mobile-tables";

// Vitest stubs CSS imports (even ?raw) to empty text, so the source is read from disk.
const mobileSource = readFileSync(join(process.cwd(), "src", "crm-port", "mobile.css"), "utf8");
const wideSource = readFileSync(join(process.cwd(), "src", "crm-port", "wide.css"), "utf8");

function outsideMediaQueries(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").trim();
}

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

  it("records the column count that sizes a phone listing", () => {
    const { host, element } = table(["A", "B", "C", "D", "E"], [["1", "2", "3", "4", "5"]]);
    labelTableCells(host);
    expect(element.style.getPropertyValue("--crm-columns")).toBe("5");
  });

  it("marks columns holding long text so phones give them more room", () => {
    const { host, element } = table(["Name", "Phone", "Reason", "Date"], [["Anita", "+91 90000 00000", "WANT TO SEE MORE DESIGNS, WANT READY PIECE", "8 Oct"], ["Bina", "+91 90000 00001", "TIME TO THINK", "7 Oct"]]);
    labelTableCells(host);
    const marked = [...element.querySelectorAll("tbody tr:first-child td")].map((cell) => cell.hasAttribute("data-crm-long"));
    expect(marked).toEqual([false, false, true, false]);
    expect(element.querySelector("tbody tr:last-child td:nth-child(3)")?.hasAttribute("data-crm-long")).toBe(true);
  });

  it("swipes phone listings sideways as compact tables instead of cards", () => {
    expect(mobileSource).not.toMatch(/thead\s*\{\s*display:\s*none/);
    expect(mobileSource).not.toMatch(/content:\s*attr\(data-label\)/);
    expect(mobileSource).toMatch(/\[class\*="overflow-x-auto"\]:has\(> table\[data-crm-cards\]\) \{ overflow-x: auto;/);
    expect(mobileSource).toMatch(/min-width: calc\(var\(--crm-columns, 8\) \* 5\.6rem\)/);
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

  it("marks a listing whose last column is its actions", () => {
    const withActions = table(["CRM Name", "Client Name", "Number", "Action"], [["A", "B", "C", "D"]]);
    labelTableCells(withActions.host);
    expect(withActions.element.hasAttribute("data-crm-actions")).toBe(true);

    const withoutActions = table(["DATE", "CLIENT ID", "TYPE", "REMARK"], [["A", "B", "C", "D"]]);
    labelTableCells(withoutActions.host);
    expect(withoutActions.element.hasAttribute("data-crm-actions")).toBe(false);
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
    expect(outsideMediaQueries(mobileSource)).toBe("");
    expect([...mobileSource.matchAll(/@media\s*\(([^)]*)\)/g)].every(([, query]) => /^max-width:\s*\d+px$/.test(query!.trim()))).toBe(true);
    // One id more than the original's strongest tier (.crm-root + four #crm-root).
    expect(MOBILE_SCOPE).toBe(".crm-root#crm-root#crm-root#crm-root#crm-root#crm-root");
    const css = scopeMobileCss(mobileSource);
    expect(css).not.toContain("#crm-mobile");
    expect(css).toContain(`${MOBILE_SCOPE} .crm-app table[data-crm-cards]`);
  });

  it("applies the full-width layout only from tablet width up, where the phone rules stop", () => {
    expect(outsideMediaQueries(wideSource)).toBe("");
    const queries = [...wideSource.matchAll(/@media\s*\(([^)]*)\)/g)].map(([, query]) => query!.trim());
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => /^min-width:\s*(\d+)px$/.test(query) && Number(/\d+/.exec(query)![0]) >= 768)).toBe(true);
    const css = scopeMobileCss(wideSource);
    expect(css).not.toContain("#crm-wide");
    expect(css).toContain(`${MOBILE_SCOPE} .crm-app table[data-crm-actions]`);
  });

  it("is attached as the single CRM style element while mounted", () => {
    const view = render(<CrmDocument title="MK Jewels CRM"><p>CRM</p></CrmDocument>);
    expect(document.querySelectorAll("style[data-crm-ui]").length).toBe(1);
    view.unmount();
    expect(document.querySelectorAll("style[data-crm-ui]").length).toBe(0);
  });
});

describe("one scroll bar on tablets and desktops (owner request 2026-10-08)", () => {
  function page(listings: number) {
    const main = document.createElement("main");
    for (let index = 0; index < listings; index += 1) {
      const { element } = table(["A", "B", "C", "D"], [["1", "2", "3", "4"]]);
      const box = document.createElement("div"); box.className = "mt-5 overflow-x-auto rounded border"; box.append(element);
      main.append(box);
    }
    labelTableCells(main);
    return main;
  }
  function fakeWindow(wide: boolean, innerHeight = 900, scrollY = 0) {
    return { matchMedia: () => ({ matches: wide }), innerHeight, scrollY } as unknown as Window;
  }
  function place(element: Element, top: number, bottom: number) {
    element.getBoundingClientRect = () => ({ top, bottom } as DOMRect);
  }
  const box = (main: HTMLElement, index = 0) => main.querySelectorAll<HTMLElement>(".overflow-x-auto")[index]!;

  it("sizes a page's only listing to the room left in the window", () => {
    const main = page(1); place(box(main), 260, 4000); place(main, 0, 4024);
    fitListingHeights(main, fakeWindow(true));
    expect(box(main).style.getPropertyValue("--crm-fit-height")).toBe("616px");
  });
  it("measures from the top of the page when the window is scrolled", () => {
    const main = page(1); place(box(main), 60, 3800); place(main, -200, 3824);
    fitListingHeights(main, fakeWindow(true, 900, 200));
    expect(box(main).style.getPropertyValue("--crm-fit-height")).toBe("616px");
  });
  it("lets the page scroll instead when there is too little room or several listings", () => {
    const tall = page(1); place(box(tall), 800, 4000); place(tall, 0, 4024);
    box(tall).style.setProperty("--crm-fit-height", "500px");
    fitListingHeights(tall, fakeWindow(true));
    expect(box(tall).style.getPropertyValue("--crm-fit-height")).toBe("");
    const several = page(2); place(box(several, 0), 200, 600); place(box(several, 1), 620, 900); place(several, 0, 920);
    fitListingHeights(several, fakeWindow(true));
    expect(box(several, 0).style.getPropertyValue("--crm-fit-height")).toBe("");
    expect(box(several, 1).style.getPropertyValue("--crm-fit-height")).toBe("");
  });
  it("leaves phones to the card layout", () => {
    const main = page(1); place(box(main), 260, 4000); place(main, 0, 4024);
    fitListingHeights(main, fakeWindow(false));
    expect(box(main).style.getPropertyValue("--crm-fit-height")).toBe("");
  });
  it("has no fixed window-height box left in wide.css", () => {
    expect(wideSource).not.toMatch(/max-height:\s*calc\(100d?vh/);
    expect(wideSource).toMatch(/max-height:\s*var\(--crm-fit-height,\s*none\)/);
  });
});
