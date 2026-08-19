import { ShieldAlert } from "lucide-react";
import { Card, PageShell } from "./ui.jsx";

export default function AccessDenied({ page, onHome }) {
  return (
    <PageShell title="You can't open this" subtitle={`${page} isn't part of your role's access.`}>
      <Card className="p-6 text-center mt-1">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-3">
          <ShieldAlert className="w-6 h-6 text-rose-500" />
        </div>
        <p className="text-sm text-slate-800 font-medium">Ask a manager to widen your access</p>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          Roles decide which screens appear. Switching role in the sidebar shows how the menu changes.
        </p>
        <button onClick={onHome}
          className="mt-5 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
          Back to home
        </button>
      </Card>
    </PageShell>
  );
}
