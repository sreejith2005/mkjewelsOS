import type { ComponentType } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui";

export type LauncherItem = Readonly<{
  Icon: ComponentType<{ className?: string }>;
  description: string;
  id: string;
  label: string;
  path: string;
}>;

export function AppLauncher({ items, onClose, onNavigate }: {
  items: readonly LauncherItem[];
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <Modal onClose={onClose} title="My Apps" tone="light">
      <p className="mb-4 text-sm text-task-text-muted">Apps available for your role.</p>
      <div className="flex flex-col gap-2">
        {items.map(({ Icon, description, id, label, path }) => (
          <button
            className="flex min-h-16 items-center gap-3 rounded-xl border border-task-border bg-task-bg p-3 text-left transition hover:bg-task-muted"
            key={id}
            onClick={() => { onNavigate(path); onClose(); }}
            type="button"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-task-accent-soft text-task-accent"><Icon className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-task-text">{label}</span>
              <span className="block text-xs text-task-text-muted">{description}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-task-text-muted" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
