import { Building2 } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { TENANT, BRANCHES, DEPARTMENTS } from "../data/org.js";
import { Card, Chip, PageShell, Reveal, SectionTitle } from "../components/ui.jsx";

export default function Settings() {
  const { profile, toast } = useStore();

  return (
    <PageShell title="Settings" subtitle={`${TENANT.name} \u00b7 ${TENANT.subscription_plan} plan`}>
      <SectionTitle>Business</SectionTitle>
      <Card className="p-4 mb-6">
        {[
          ["Name", TENANT.name],
          ["Currency", TENANT.currency],
          ["Timezone", TENANT.timezone],
          ["Plan", TENANT.subscription_plan],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
            <span className="text-xs text-slate-500">{k}</span>
            <span className="text-xs text-slate-900 font-medium capitalize">{v}</span>
          </div>
        ))}
      </Card>

      <SectionTitle>Branches</SectionTitle>
      <div className="space-y-2.5 mb-6">
        {BRANCHES.map((b, i) => (
          <Reveal key={b.id} delay={i * 30}>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-slate-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{b.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 capitalize">{b.type} &middot; {b.city} &middot; code {b.code}</p>
                </div>
                {profile.branch_id === b.id && <Chip className="bg-amber-100 text-amber-800">You're here</Chip>}
              </div>
            </Card>
          </Reveal>
        ))}
      </div>

      <SectionTitle>Departments</SectionTitle>
      <Card className="p-4">
        <div className="flex flex-wrap gap-1.5">
          {DEPARTMENTS.map((d) => <Chip key={d.id} className="bg-slate-100 text-slate-700">{d.name}</Chip>)}
        </div>
      </Card>

      <button onClick={() => toast("Nothing to save in the demo build")}
        className="w-full mt-6 py-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium focus-visible:ring-2 focus-visible:ring-amber-500">
        Save changes
      </button>
    </PageShell>
  );
}
