import { CheckCircle2, Home, LayoutGrid } from "lucide-react";
import { TASK_IN_LOOP_PATH, sidebarCountLabel } from "@jewelos/core";
import { cn } from "@/lib/utils";

type MobileBottomNavProps = {
  menuOpen?: boolean;
  onNavigate: (path: string) => void;
  /** Opens the full section menu; without it the bar shows only Home and Tasks. */
  onOpenMenu?: () => void;
  path: string;
  taskCount?: number | undefined;
};

const TASK_PATHS = new Set(["/tasks", "/tasks/checklist", "/tasks/delegation", TASK_IN_LOOP_PATH, "/tasks/fms", "/tasks/import", "/tasks/assigning-left"]);

export function MobileBottomNav({ menuOpen = false, onNavigate, onOpenMenu, path, taskCount }: MobileBottomNavProps) {
  const destinations = [
    // "/" is where every signed-in employee lands, so it is the tab that has to
    // read as selected on arrival.
    { icon: Home, label: "Home", onSelect: () => onNavigate("/"), selected: path === "/" },
    { icon: CheckCircle2, label: "Tasks", onSelect: () => onNavigate("/tasks"), selected: TASK_PATHS.has(path) },
    ...(onOpenMenu ? [{ icon: LayoutGrid, label: "More", onSelect: onOpenMenu, selected: menuOpen }] : []),
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-task-border/80 bg-task-bg/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_rgb(var(--color-shadow)/0.25)] backdrop-blur-xl md:hidden"
    >
      <div className={cn("mx-auto grid max-w-lg gap-1 px-3 py-1.5", destinations.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {destinations.map(({ icon: Icon, label, onSelect, selected }) => (
          <button
            aria-current={selected && label !== "More" ? "page" : undefined}
            aria-expanded={label === "More" ? menuOpen : undefined}
            className={cn(
              "group flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-[11px] font-semibold leading-none transition-colors active:bg-task-muted",
              selected ? "text-gold-secondary" : "text-task-text-muted",
            )}
            key={label}
            onClick={onSelect}
            type="button"
          >
            <span className={cn("flex h-8 w-14 items-center justify-center rounded-full transition-[background-color,transform] duration-200 group-active:scale-90", selected ? "bg-gold/15" : "bg-transparent")}>
              <Icon className="size-[22px]" strokeWidth={selected ? 2.4 : 1.9} />
            </span>
            <span>{sidebarCountLabel(label, label === "Tasks" ? taskCount : undefined)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
