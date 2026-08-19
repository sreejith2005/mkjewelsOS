import { useState } from "react";
import { FileText } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { FORM_TEMPLATES } from "../data/forms.js";
import { relDays } from "../lib/utils.js";
import { Card, Chip, EmptyState, PageShell, Reveal, Sheet, Tabs } from "../components/ui.jsx";
import FormRenderer from "../components/FormRenderer.jsx";

export default function Forms() {
  const { profile, submissions, submitForm, reviewSubmission, toast } = useStore();
  const [tab, setTab] = useState("library");
  const [fillId, setFillId] = useState(null);
  const [viewSub, setViewSub] = useState(null);

  const canReview = ["super_admin", "admin", "manager"].includes(profile.role_level);
  const templates = FORM_TEMPLATES.filter(
    (f) => f.access_roles.includes(profile.role_level) || profile.permissions?.includes("*")
  );
  const form = FORM_TEMPLATES.find((f) => f.id === fillId);

  if (form) {
    return (
      <PageShell title={form.name} subtitle={form.description} back={() => setFillId(null)} backLabel="Forms">
        <FormRenderer form={form} onSubmit={(display) => { submitForm(form.id, display); setFillId(null); }} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Forms" subtitle="Structured capture that feeds tasks, workflows and reports">
      <Tabs value={tab} onChange={setTab}
        items={[{ id: "library", label: "Forms" }, { id: "subs", label: `Submissions (${submissions.length})` }]} />

      {tab === "library" && (
        <div className="space-y-2.5 mt-4">
          {templates.length === 0 ? (
            <Card><EmptyState icon={FileText} title="No forms for your role" hint="Ask a manager to widen the access list on the forms you need." /></Card>
          ) : templates.map((f, i) => (
            <Reveal key={f.id} delay={i * 40}>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-white" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{f.name}</p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{f.description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      <Chip className="bg-slate-100 text-slate-600">{f.fields.length} fields</Chip>
                      <Chip className="bg-slate-100 text-slate-600">{f.submissions_count} submitted</Chip>
                      <Chip className="bg-slate-100 text-slate-600 capitalize">{f.category}</Chip>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3.5">
                  <button onClick={() => setFillId(f.id)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
                    Fill it in
                  </button>
                  {canReview && (
                    <button onClick={() => toast("Field builder opens here")}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500">
                      Edit fields
                    </button>
                  )}
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      )}

      {tab === "subs" && (
        <div className="space-y-2.5 mt-4">
          {submissions.length === 0 ? (
            <Card><EmptyState icon={FileText} title="No submissions yet" hint="Fill in a form and it lands here for review." /></Card>
          ) : submissions.slice().reverse().map((s, i) => {
            const t = FORM_TEMPLATES.find((f) => f.id === s.form_template_id);
            return (
              <Reveal key={s.id} delay={i * 40}>
                <Card onClick={() => setViewSub(s)} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{t?.name}</p>
                      <p className="text-xs text-slate-500 mt-1 truncate">
                        {Object.values(s.data_display)[0]} &middot; {relDays(s.submitted_on)}
                      </p>
                    </div>
                    <Chip className={
                      s.status === "approved" ? "bg-emerald-100 text-emerald-700"
                      : s.status === "rejected" ? "bg-rose-100 text-rose-700"
                      : "bg-amber-100 text-amber-700"
                    }>
                      {s.status}
                    </Chip>
                  </div>
                </Card>
              </Reveal>
            );
          })}
        </div>
      )}

      <Sheet open={!!viewSub} title="Submission" onClose={() => setViewSub(null)}>
        {viewSub && (
          <>
            <div className="space-y-3">
              {Object.entries(viewSub.data_display).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 pb-3 border-b border-slate-100">
                  <span className="text-xs text-slate-500 shrink-0">{k}</span>
                  <span className="text-xs text-slate-900 font-medium text-right">{String(v)}</span>
                </div>
              ))}
            </div>
            {canReview && viewSub.status === "pending" && (
              <div className="flex gap-2 mt-5">
                <button onClick={() => { reviewSubmission(viewSub.id, "approved"); setViewSub(null); }}
                  className="flex-1 py-3 rounded-xl bg-slate-900 text-white text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
                  Approve
                </button>
                <button onClick={() => { reviewSubmission(viewSub.id, "rejected"); setViewSub(null); }}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500">
                  Send back
                </button>
              </div>
            )}
          </>
        )}
      </Sheet>
    </PageShell>
  );
}
