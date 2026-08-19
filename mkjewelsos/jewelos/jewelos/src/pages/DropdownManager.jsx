import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { DROPDOWN_CONFIG } from "../data/org.js";
import { Card, Chip, PageShell, Reveal } from "../components/ui.jsx";

export default function DropdownManager() {
  const { toast } = useStore();
  const [open, setOpen] = useState("customer_types");

  return (
    <PageShell title="Dropdowns" subtitle="The option lists every form and filter reads from">
      <div className="space-y-2.5 mt-1">
        {Object.entries(DROPDOWN_CONFIG).map(([key, vals], i) => (
          <Reveal key={key} delay={i * 30}>
            <Card className="overflow-hidden">
              <button onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}
                className="w-full flex items-center justify-between p-4 text-left focus-visible:ring-2 focus-visible:ring-amber-500">
                <div>
                  <p className="text-sm font-medium text-slate-900 capitalize">{key.replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{vals.length} options</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open === key ? "rotate-180" : ""}`} />
              </button>
              {open === key && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100">
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {vals.map((v) => (
                      <Chip key={v} className="bg-slate-100 text-slate-700 capitalize">{v.replace(/_/g, " ")}</Chip>
                    ))}
                  </div>
                  <button onClick={() => toast("Option editor opens here")}
                    className="text-xs font-medium text-amber-700 mt-3 focus-visible:underline">
                    Add an option
                  </button>
                </div>
              )}
            </Card>
          </Reveal>
        ))}
      </div>
    </PageShell>
  );
}
