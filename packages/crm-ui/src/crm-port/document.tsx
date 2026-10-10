// crm-port: the Next root document (<html><body> + app/globals.css) becomes one CRM root
// element inside JewelOS. The original globals.css is compiled with Tailwind 4 and scoped to
// this element by scripts/build-css.mjs; the stylesheet is attached only while the CRM is
// mounted, so it never applies to other JewelOS routes.
//
// The phone layout (crm-port/mobile.css, owner request 2026-10-07) is appended to the same
// <style> element. Its "#crm-mobile" placeholder becomes MOBILE_SCOPE: one id more than the
// strongest tier of crm.generated.css (.crm-root + four #crm-root), so a phone rule wins over
// the original rule it adjusts while the original file stays verbatim. The tablet and desktop
// layout (crm-port/wide.css, owner request 2026-10-08: full width, listings that scroll inside
// the window) follows it with the same scope through its "#crm-wide" placeholder.
import { useLayoutEffect, useRef, type ReactNode } from "react";

import crmCss from "@/styles/crm.generated.css?raw";

import mobileCss from "./mobile.css?raw";
import wideCss from "./wide.css?raw";
import { watchTableCells } from "./mobile-tables";

export const CRM_ROOT_ID = "crm-root";
export const MOBILE_SCOPE = `.crm-root${`#${CRM_ROOT_ID}`.repeat(5)}`;

export function scopeMobileCss(source: string): string {
  return source.replaceAll("#crm-mobile", MOBILE_SCOPE).replaceAll("#crm-wide", MOBILE_SCOPE);
}

export function crmStylesheet(): string {
  return `${crmCss}\n${scopeMobileCss(mobileCss)}\n${scopeMobileCss(wideCss)}`;
}

export function CrmDocument({ title, children }: { title: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const style = document.createElement("style");
    style.dataset.crmUi = "crm.generated.css";
    style.textContent = crmStylesheet();
    document.head.appendChild(style);
    const previousTitle = document.title;
    document.title = title;
    return () => {
      style.remove();
      document.title = previousTitle;
    };
  }, [title]);
  useLayoutEffect(() => (root.current ? watchTableCells(root.current) : undefined), []);
  return <div ref={root} id={CRM_ROOT_ID} className="crm-root" lang="en">{children}</div>;
}
