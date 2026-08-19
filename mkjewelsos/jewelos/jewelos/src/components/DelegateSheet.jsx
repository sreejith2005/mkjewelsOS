import { useState } from "react";
import { Check } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { initials } from "../lib/utils.js";
import { Sheet } from "./ui.jsx";

export default function DelegateSheet() {
  const { delegateFor, closeDelegate, users, profile, delegateTask } = useStore();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  const candidates = users.filter((u) => u.id !== profile.id && u.working_status === "active");

  const submit = () => {
    delegateTask(delegateFor, to, reason);
    setTo("");
    setReason("");
  };

  return (
    <Sheet open={!!delegateFor} title="Delegate this task" onClose={closeDelegate}>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        The task moves to their list today. You stay named as the person it came from.
      </p>

      <label className="block text-xs font-medium text-slate-700 mb-2">Hand it to</label>
      <div className="space-y-1.5 mb-4">
        {candidates.map((u) => (
          <button
            key={u.id}
            onClick={() => setTo(u.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left focus-visible:ring-2 focus-visible:ring-amber-500 ${
              to === u.id ? "border-slate-900 bg-slate-50" : "border-slate-200"
            }`}
          >
            <span className="w-9 h-9 rounded-full bg-slate-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">
              {initials(u.name)}
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-slate-900 truncate">{u.name}</span>
              <span className="block text-xs text-slate-500 truncate">{u.designation}</span>
            </span>
            {to === u.id && <Check className="w-4 h-4 text-slate-900 ml-auto shrink-0" />}
          </button>
        ))}
      </div>

      <label className="block text-xs font-medium text-slate-700 mb-2">Why (they'll see this)</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="At the trade show until Thursday"
        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      />

      <button
        disabled={!to}
        onClick={submit}
        className="w-full mt-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        Delegate task
      </button>
    </Sheet>
  );
}
