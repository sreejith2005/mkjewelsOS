import { useState } from "react";
import { Check, Star } from "lucide-react";
import { inr, fmtDateLong } from "../lib/utils.js";
import { inputBase } from "./ui.jsx";

/* Renders a FormTemplate. Handles required fields, type validation,
   conditional visibility and scroll-to-first-error. */

export default function FormRenderer({ form, onSubmit }) {
  const [vals, setVals] = useState({});
  const [errs, setErrs] = useState({});

  const set = (id, v) => {
    setVals((p) => ({ ...p, [id]: v }));
    setErrs((p) => ({ ...p, [id]: null }));
  };

  const isVisible = (f) => !f.visible_when || vals[f.visible_when.field] === f.visible_when.equals;

  const submit = () => {
    const e = {};
    form.fields.forEach((f) => {
      if (!isVisible(f)) return;
      const v = vals[f.id];
      const empty = v === undefined || v === "" || v === null || v === false;
      if (f.required && empty) e[f.id] = "This one is needed before you can send.";
      if (f.type === "email" && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) e[f.id] = "That doesn't look like an email address.";
      if (f.type === "phone" && v && String(v).replace(/\D/g, "").length < 10) e[f.id] = "A phone number needs at least 10 digits.";
      if ((f.type === "number" || f.type === "currency") && v && Number(v) <= 0) e[f.id] = "Enter a number above zero.";
    });

    setErrs(e);
    if (Object.keys(e).length) {
      document.getElementById(`fld_${Object.keys(e)[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const display = {};
    form.fields.forEach((f) => {
      if (!isVisible(f)) return;
      const v = vals[f.id];
      if (v === undefined || v === "" || v === null) return;
      display[f.label] =
        f.type === "currency" ? inr(v)
        : f.type === "checkbox" ? (v ? "Yes" : "No")
        : f.type === "rating" ? `${v} / 5`
        : f.type === "date" ? fmtDateLong(v)
        : String(v);
    });
    onSubmit(display);
  };

  return (
    <div className="mt-1">
      <div className="grid grid-cols-2 gap-x-3">
        {form.fields.filter(isVisible).map((f) => {
          const err = errs[f.id];
          const border = err ? "border-rose-400" : "border-slate-200";
          return (
            <div key={f.id} id={`fld_${f.id}`} className={f.width === "half" ? "col-span-1" : "col-span-2"}>
              <div className="mb-4">
                {f.type !== "checkbox" && (
                  <label htmlFor={`in_${f.id}`} className="block text-xs font-medium text-slate-700 mb-2">
                    {f.label}
                    {f.required && <span className="text-rose-500 ml-0.5">*</span>}
                  </label>
                )}

                {["text", "email", "phone"].includes(f.type) && (
                  <input
                    id={`in_${f.id}`} type="text" value={vals[f.id] || ""} placeholder={f.placeholder}
                    onChange={(e) => set(f.id, e.target.value)} className={`${inputBase} ${border}`}
                  />
                )}

                {["number", "currency"].includes(f.type) && (
                  <div className="relative">
                    {f.type === "currency" && <span className="absolute left-3 top-2.5 text-sm text-slate-400">&#8377;</span>}
                    <input
                      id={`in_${f.id}`} type="number" value={vals[f.id] || ""} placeholder={f.placeholder}
                      onChange={(e) => set(f.id, e.target.value)}
                      className={`${inputBase} ${border} ${f.type === "currency" ? "pl-7" : ""}`}
                    />
                  </div>
                )}

                {f.type === "date" && (
                  <input id={`in_${f.id}`} type="date" value={vals[f.id] || ""}
                    onChange={(e) => set(f.id, e.target.value)} className={`${inputBase} ${border}`} />
                )}

                {f.type === "textarea" && (
                  <textarea id={`in_${f.id}`} rows={3} value={vals[f.id] || ""} placeholder={f.placeholder}
                    onChange={(e) => set(f.id, e.target.value)} className={`${inputBase} ${border} resize-none`} />
                )}

                {f.type === "select" && (
                  <select id={`in_${f.id}`} value={vals[f.id] || ""} onChange={(e) => set(f.id, e.target.value)}
                    className={`${inputBase} ${border}`}>
                    <option value="">Choose one</option>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}

                {f.type === "checkbox" && (
                  <button onClick={() => set(f.id, !vals[f.id])}
                    className="flex items-start gap-2.5 text-left w-full py-1 rounded-lg focus-visible:ring-2 focus-visible:ring-amber-500">
                    <span className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${vals[f.id] ? "bg-slate-900 border-slate-900" : "border-slate-300 bg-white"}`}>
                      {vals[f.id] && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="text-xs text-slate-700 leading-relaxed">{f.label}</span>
                  </button>
                )}

                {f.type === "rating" && (
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => set(f.id, n)} aria-label={`${n} out of 5`}
                        className="rounded-lg p-1 focus-visible:ring-2 focus-visible:ring-amber-500">
                        <Star
                          className={`w-6 h-6 ${(vals[f.id] || 0) >= n ? "text-amber-500" : "text-slate-200"}`}
                          fill={(vals[f.id] || 0) >= n ? "currentColor" : "none"}
                        />
                      </button>
                    ))}
                  </div>
                )}

                {err && <p className="text-xs text-rose-600 mt-1.5">{err}</p>}
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={submit}
        className="w-full py-3.5 rounded-xl bg-slate-900 text-white text-sm font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
        Send it in
      </button>
      <p className="text-xs text-slate-400 text-center mt-3">Goes to the {form.category} queue for review.</p>
    </div>
  );
}
