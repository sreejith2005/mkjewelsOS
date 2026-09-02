import { CheckCircle2, Home, Menu, PanelsTopLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type MobileBottomNavProps = {
  onNavigate: (path: string) => void;
  onOpenApps: () => void;
  onOpenMore: () => void;
  path: string;
};

const TASK_PATHS = new Set(["/tasks", "/tasks/checklist", "/tasks/delegation", "/tasks/fms", "/tasks/import", "/tasks/assigning-left"]);

export function MobileBottomNav({ onNavigate, onOpenApps, onOpenMore, path }: MobileBottomNavProps) {
  const destinations = [
    // "/" is where every signed-in employee lands, so it is the tab that has to
    // read as selected on arrival.
    { icon: Home, label: "Home", onSelect: () => onNavigate("/"), selected: path === "/" },
    { icon: CheckCircle2, label: "Tasks", onSelect: () => onNavigate("/tasks"), selected: TASK_PATHS.has(path) },
    { icon: PanelsTopLeft, label: "My Apps", onSelect: onOpenApps, selected: false },
    { icon: Menu, label: "More", onSelect: onOpenMore, selected: false },
  ] as const;

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-task-border bg-task-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 py-1.5">
        {destinations.map(({ icon: Icon, label, onSelect, selected }) => (
          <button
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-semibold leading-none transition-colors active:bg-task-muted",
              selected ? "bg-task-accent-soft text-task-accent" : "text-task-text-muted",
            )}
            key={label}
            onClick={onSelect}
            type="button"
          >
            <Icon className="size-[22px]" strokeWidth={selected ? 2.4 : 1.9} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
