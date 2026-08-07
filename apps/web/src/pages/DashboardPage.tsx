import { ArrowRight, CheckCircle2, LayoutDashboard } from "lucide-react";
import type { LauncherItem } from "@/components/shell/AppLauncher";
import { useAuth } from "@/auth/AuthContext";

export function DashboardPage({ items, onNavigate }: { items: readonly LauncherItem[]; onNavigate: (path: string) => void }) {
  const { branch, profile } = useAuth();
  return (
    <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted p-4 text-task-text sm:-m-6 sm:p-6 md:min-h-[calc(100vh-4rem)]">
      <header className="mb-6 rounded-2xl bg-task-bg p-5 shadow-sm">
        <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-task-accent-soft text-task-accent"><LayoutDashboard className="size-6" /></span>
        <h1 className="text-2xl font-semibold">Welcome, {profile?.employee_name?.split(" ")[0] ?? "there"}</h1>
        <p className="mt-1 text-sm text-task-text-muted">{branch?.name ?? "Your branch"} · Choose an available workspace.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button className="flex min-h-24 items-center gap-4 rounded-2xl border border-task-border bg-task-bg p-4 text-left shadow-sm hover:bg-task-muted" onClick={() => onNavigate("/tasks/checklist")} type="button">
          <span className="flex size-11 items-center justify-center rounded-xl bg-task-accent-soft text-task-accent"><CheckCircle2 className="size-6" /></span>
          <span className="flex-1"><span className="block font-semibold">My Tasks</span><span className="text-xs text-task-text-muted">View assigned and watched work.</span></span>
          <ArrowRight className="size-4 text-task-text-muted" />
        </button>
        {items.map(({ Icon, description, id, label, path }) => (
          <button className="flex min-h-24 items-center gap-4 rounded-2xl border border-task-border bg-task-bg p-4 text-left shadow-sm hover:bg-task-muted" key={id} onClick={() => onNavigate(path)} type="button">
            <span className="flex size-11 items-center justify-center rounded-xl bg-task-accent-soft text-task-accent"><Icon className="size-6" /></span>
            <span className="flex-1"><span className="block font-semibold">{label}</span><span className="text-xs text-task-text-muted">{description}</span></span>
            <ArrowRight className="size-4 text-task-text-muted" />
          </button>
        ))}
      </div>
    </section>
  );
}
