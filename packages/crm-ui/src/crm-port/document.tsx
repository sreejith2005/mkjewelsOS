// crm-port: the Next root document (<html><body> + app/globals.css) becomes one CRM root
// element inside JewelOS. The original globals.css is compiled with Tailwind 4 and scoped to
// this element by scripts/build-css.mjs; the stylesheet is attached only while the CRM is
// mounted, so it never applies to other JewelOS routes.
import { useLayoutEffect, type ReactNode } from "react";

import crmCss from "@/styles/crm.generated.css?raw";

export const CRM_ROOT_ID = "crm-root";

export function CrmDocument({ title, children }: { title: string; children: ReactNode }) {
  useLayoutEffect(() => {
    const style = document.createElement("style");
    style.dataset.crmUi = "crm.generated.css";
    style.textContent = crmCss;
    document.head.appendChild(style);
    const previousTitle = document.title;
    document.title = title;
    return () => {
      style.remove();
      document.title = previousTitle;
    };
  }, [title]);
  return <div id={CRM_ROOT_ID} className="crm-root" lang="en">{children}</div>;
}
