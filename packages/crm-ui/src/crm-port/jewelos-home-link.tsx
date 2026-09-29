// crm-port: the single JewelOS addition to the original CRM shell: a menu entry back to
// JewelOS Home. It uses the existing menu link style and is marked data-crm-port so the
// parity harness can exclude it from the original-vs-port comparison.
import { crmHost } from "./runtime";

export function JewelosHomeLink({ onNavigate }: { onNavigate: () => void }) {
  const host = crmHost();
  return <a
    className="crm-nav-link"
    data-crm-port="jewelos-home"
    href={host.jewelosHomePath}
    onClick={(event) => {
      onNavigate();
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      host.navigate(host.jewelosHomePath);
    }}
  >← JewelOS</a>;
}
