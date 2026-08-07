import { LogOut } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import type { LauncherItem } from "./AppLauncher";

export function MoreSheet({ branchName, items, onClose, onLogout, onNavigate, profileName, roleLabel }: {
  branchName: string;
  items: readonly LauncherItem[];
  onClose: () => void;
  onLogout: () => Promise<void>;
  onNavigate: (path: string) => void;
  profileName: string;
  roleLabel: string;
}) {
  return (
    <Modal onClose={onClose} title="More" tone="light">
      <div className="mb-5 rounded-xl bg-task-muted p-4">
        <p className="text-sm font-semibold text-task-text">{profileName}</p>
        <p className="mt-1 text-xs text-task-text-muted">{roleLabel} · {branchName}</p>
      </div>
      <nav aria-label="More navigation" className="flex flex-col gap-1">
        {items.map(({ Icon, id, label, path }) => (
          <button className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-task-text hover:bg-task-muted" key={id} onClick={() => { onNavigate(path); onClose(); }} type="button">
            <Icon className="size-5 text-task-text-muted" />{label}
          </button>
        ))}
      </nav>
      <Button className="mt-5 w-full border-task-border bg-task-bg text-task-overdue hover:bg-task-muted" onClick={() => void onLogout()} variant="secondary">
        <LogOut />Sign out
      </Button>
    </Modal>
  );
}
