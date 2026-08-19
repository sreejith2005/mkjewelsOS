import { useState } from "react";
import {
  Search, ChevronRight, ChevronLeft, Phone, Mail, Calendar, Award, UserCog,
  MessageSquare, MapPin, Repeat, Users,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { DROPDOWN_CONFIG } from "../data/org.js";
import { CUSTOMER_TYPE, initials, inr, fmtDate, fmtDateLong, relDays, TODAY_ISO } from "../lib/utils.js";
import {
  Card, Chip, EmptyState, PageShell, Reveal, SectionTitle, Sheet, Field,
  InfoRow, MiniStat, FilterRow, inputBase,
} from "../components/ui.jsx";

function LogInteractionSheet({ open, onClose, onSave }) {
  const [type, setType] = useState("call");
  const [subject, setSubject] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!subject.trim()) {
      setErr("Add a subject so this is findable later.");
      return;
    }
    onSave({ type, subject: subject.trim(), outcome: outcome.trim() || "\u2014", follow_up_date: followUp || null });
    setSubject(""); setOutcome(""); setFollowUp(""); setErr("");
  };

  return (
    <Sheet open={open} title="Log an interaction" onClose={onClose}>
      <label className="block text-xs font-medium text-slate-700 mb-2">What happened</label>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {DROPDOWN_CONFIG.interaction_types.map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`py-2.5 rounded-xl border text-xs font-medium capitalize focus-visible:ring-2 focus-visible:ring-amber-500 ${
              type === t ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
            }`}>
            {t === "follow_up" ? "Follow-up" : t}
          </button>
        ))}
      </div>

      <Field label="Subject" required>
        <input value={subject} onChange={(e) => { setSubject(e.target.value); setErr(""); }}
          placeholder="Viewed the solitaire collection" className={`${inputBase} border-slate-200`} />
      </Field>
      {err && <p className="text-xs text-rose-600 -mt-2 mb-3">{err}</p>}

      <Field label="Outcome">
        <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={3}
          placeholder="Shortlisted three pieces, wants a matching band"
          className={`${inputBase} border-slate-200 resize-none`} />
      </Field>

      <Field label="Follow up on">
        <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)}
          className={`${inputBase} border-slate-200`} />
      </Field>

      <button onClick={submit}
        className="w-full mt-2 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
        Save interaction
      </button>
    </Sheet>
  );
}

export default function CRM() {
  const { profile, customers, interactions, users, addInteraction, toast } = useStore();
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [logFor, setLogFor] = useState(null);

  const visible = customers.filter((c) => profile.accessible_branches.includes(c.branch_id));
  const list = visible.filter((c) => {
    const name = `${c.first_name} ${c.last_name}`.toLowerCase();
    const matchQ = !q || name.includes(q.toLowerCase()) || c.phone.includes(q);
    return matchQ && (type === "all" || c.customer_type === type);
  });

  const detail = customers.find((c) => c.id === openId);

  if (detail) {
    const hist = interactions
      .filter((i) => i.customer_id === detail.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const owner = users.find((u) => u.id === detail.assigned_to);

    return (
      <div>
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-5 pb-9">
          <button onClick={() => setOpenId(null)} className="flex items-center gap-1 text-slate-400 text-xs mb-4 focus-visible:underline">
            <ChevronLeft className="w-3.5 h-3.5" /> Customers
          </button>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
              {initials(`${detail.first_name} ${detail.last_name}`)}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{detail.first_name} {detail.last_name}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Chip className={CUSTOMER_TYPE[detail.customer_type]}>{detail.customer_type}</Chip>
                <span className="text-xs text-slate-400">{detail.loyalty_points.toLocaleString("en-IN")} points</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <MiniStat label="Last purchase" value={inr(detail.last_purchase)} />
            <MiniStat label="Interactions" value={hist.length} />
            <MiniStat label="Source" value={detail.source.replace(/_/g, " ")} />
          </div>
        </div>

        <div className="bg-slate-50 rounded-t-3xl -mt-4 px-6 pt-6 pb-8">
          <Card className="p-4 mb-4">
            <div className="space-y-2.5">
              <InfoRow icon={Phone} label={detail.phone} />
              <InfoRow icon={Mail} label={detail.email} />
              {detail.dob && <InfoRow icon={Calendar} label={`Born ${fmtDateLong(detail.dob)}`} />}
              {detail.anniversary && <InfoRow icon={Award} label={`Anniversary ${fmtDateLong(detail.anniversary)}`} />}
              <InfoRow icon={UserCog} label={`Handled by ${owner?.name || "unassigned"}`} />
            </div>
            {detail.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3.5 pt-3.5 border-t border-slate-100">
                {detail.tags.map((t) => <Chip key={t} className="bg-slate-100 text-slate-600">{t}</Chip>)}
              </div>
            )}
          </Card>

          <div className="flex gap-2 mb-5">
            <button onClick={() => setLogFor(detail.id)}
              className="flex-1 py-3 rounded-xl bg-slate-900 text-white text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
              Log an interaction
            </button>
            <button onClick={() => toast("Opens WhatsApp Business")} aria-label="Message on WhatsApp"
              className="px-4 py-3 rounded-xl border border-slate-200 text-slate-700 focus-visible:ring-2 focus-visible:ring-amber-500">
              <MessageSquare className="w-4 h-4" />
            </button>
          </div>

          <SectionTitle>History</SectionTitle>
          {hist.length === 0 ? (
            <Card>
              <EmptyState icon={MessageSquare} title="Nothing logged yet"
                hint="Every call, visit and message goes here so the next person picks up where you left off." />
            </Card>
          ) : (
            <div className="space-y-2.5">
              {hist.map((h, i) => (
                <Reveal key={h.id} delay={i * 40}>
                  <Card className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                        {h.type === "call" ? <Phone className="w-3.5 h-3.5 text-slate-600" />
                          : h.type === "visit" ? <MapPin className="w-3.5 h-3.5 text-slate-600" />
                          : h.type === "whatsapp" ? <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
                          : <Repeat className="w-3.5 h-3.5 text-slate-600" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-900 font-medium leading-snug">{h.subject}</p>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{h.outcome}</p>
                        <p className="text-xs text-slate-400 mt-2">
                          {fmtDate(h.date)} &middot; {users.find((u) => u.id === h.user_id)?.name.split(" ")[0]}
                          {h.follow_up_date && (
                            <span className="text-amber-700"> &middot; follow up {relDays(h.follow_up_date).toLowerCase()}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </Card>
                </Reveal>
              ))}
            </div>
          )}
        </div>

        <LogInteractionSheet open={!!logFor} onClose={() => setLogFor(null)}
          onSave={(payload) => { addInteraction({ ...payload, customer_id: logFor }); setLogFor(null); }} />
      </div>
    );
  }

  return (
    <PageShell title="Customers" subtitle={`${visible.length} on file across your branches`}>
      <div className="relative mt-1">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or number"
          className={`${inputBase} border-slate-200 pl-10 py-3`} />
      </div>

      <div className="mt-3">
        <FilterRow value={type} onChange={setType}
          options={[["all", "All"], ...DROPDOWN_CONFIG.customer_types.map((t) => [t, t])]} />
      </div>

      <div className="space-y-2.5 mt-4">
        {list.length === 0 ? (
          <Card><EmptyState icon={Users} title="No customers match" hint="Clear the search or pick a different type." /></Card>
        ) : (
          list.map((c, i) => {
            const last = interactions.filter((x) => x.customer_id === c.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
            const dueToday = interactions.some((x) => x.customer_id === c.id && x.follow_up_date === TODAY_ISO);
            return (
              <Reveal key={c.id} delay={i * 35}>
                <Card onClick={() => setOpenId(c.id)} className="p-4">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                      {initials(`${c.first_name} ${c.last_name}`)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-900 truncate">{c.first_name} {c.last_name}</p>
                        <Chip className={CUSTOMER_TYPE[c.customer_type]}>{c.customer_type}</Chip>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{last ? last.subject : c.phone}</p>
                      {dueToday && <p className="text-xs text-amber-700 font-medium mt-1">Follow-up due today</p>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </div>
                </Card>
              </Reveal>
            );
          })
        )}
      </div>
    </PageShell>
  );
}
