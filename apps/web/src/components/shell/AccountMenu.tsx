import { useEffect, useId, useRef, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { initials, titleCase } from "@/lib/format";
import type { UserProfile } from "@/types";

export function AccountMenu({ profile, branchName, roleLabel, settingsPath, navigate, onLogout }: {
  profile: UserProfile;
  /** Shown instead of the stored role (a Director is stored as Admin). */
  roleLabel?: string | undefined;
  branchName: string;
  settingsPath: string | undefined;
  navigate: (path: string) => void;
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await onLogout();
      setOpen(false);
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  return <div className="relative" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button aria-label="Account menu" aria-expanded={open} aria-controls={open ? panelId : undefined} className="flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" onClick={() => setOpen(!open)} ref={trigger} type="button">
      <span className="flex size-9 items-center justify-center rounded-full bg-gold-sheen text-xs font-bold tracking-wide text-on-gold shadow-gold ring-2 ring-task-bg md:size-10 md:text-sm">{initials(profile.employee_name)}</span>
    </button>
    {open ? <section aria-label="Your account" className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-task-border bg-task-bg text-task-text shadow-lift" id={panelId}>
      <div className="border-b border-task-border p-4">
        <p className="break-words font-semibold">{profile.employee_name}</p>
        <p className="mt-1 text-xs text-task-text-muted">{roleLabel ?? titleCase(profile.user_role)} · {branchName}</p>
        <p className="mt-1 break-words text-xs text-task-text-muted">{profile.email}</p>
      </div>
      {settingsPath ? <button className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-task-muted" onClick={() => { setOpen(false); navigate(settingsPath); trigger.current?.focus(); }} type="button"><Settings aria-hidden className="size-4"/>Settings</button> : null}
      <button className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm text-task-overdue hover:bg-task-muted disabled:opacity-50" disabled={signingOut} onClick={() => void signOut()} type="button"><LogOut aria-hidden className="size-4"/>{signingOut ? "Signing out…" : "Sign out"}</button>
      {error ? <p className="px-4 pb-3 text-sm text-task-overdue" role="alert">{error}</p> : null}
    </section> : null}
  </div>;
}
