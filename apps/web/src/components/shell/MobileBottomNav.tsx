import { CheckCircle2, LayoutDashboard, Menu, PanelsTopLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type MobileBottomNavProps = {
  onNavigate: (path: string) => void;
  onOpenApps: () => void;
  onOpenMore: () => void;
  path: string;
};

export function MobileBottomNav({ onNavigate, onOpenApps, onOpenMore, path }: MobileBottomNavProps) {
  const destinations = [
    { icon: LayoutDashboard, label: "Dashboard", onSelect: () => onNavigate("/dashboard"), selected: path === "/dashboard" },
    { icon: CheckCircle2, label: "Tasks", onSelect: () => onNavigate("/tasks"), selected: path === "/tasks" || path === "/tasks/checklist" || path === "/tasks/delegation" },
    { icon: PanelsTopLeft, label: "My Apps", onSelect: onOpenApps, selected: false },
    { icon: Menu, label: "More", onSelect: onOpenMore, selected: false },
  ] as const;

  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-task-border bg-task-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto grid h-[70px] max-w-lg grid-cols-4 px-1">
        {destinations.map(({ icon: Icon, label, onSelect, selected }) => (
          <button
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex min-h-12 min-w-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium text-task-text-muted",
              selected && "text-task-accent",
            )}
            key={label}
            onClick={onSelect}
            type="button"
          >
            <Icon className="size-5" strokeWidth={selected ? 2.4 : 2} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
