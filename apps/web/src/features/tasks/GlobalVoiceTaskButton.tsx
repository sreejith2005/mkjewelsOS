import { Suspense, useCallback, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import type { UserProfile } from "@/types";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { lazyPage } from "@/lib/lazyPage";

const GlobalVoiceTaskComposer = lazyPage("global-voice-task", () => import("./GlobalVoiceTaskComposer").then((module) => ({ default: module.GlobalVoiceTaskComposer })));

/**
 * The app-wide "assign by voice" control. Offering it is a usability choice
 * only: the composer it opens writes through the same audited task RPC, and
 * the voice Edge Function checks `tasks.voice_assign` itself.
 *
 * `raised` lifts it above a page's own bottom-right action (the Tasks page
 * Create Task button) so the two never overlap.
 */
export function GlobalVoiceTaskButton({ profile, raised = false }: { profile: UserProfile; raised?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const close = useCallback(() => { setOpen(false); setLoading(false); }, []);
  const ready = useCallback(() => setLoading(false), []);
  const position = cn("fixed right-4 z-20 md:right-8", raised ? "bottom-[calc(9.5rem+env(safe-area-inset-bottom))] md:bottom-28" : "bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-8");

  return (
    <>
      {open ? null : <div className={position}>
        <Button aria-label="Assign a task by voice" className="size-14 rounded-full bg-task-accent p-0 text-task-text shadow-xl hover:bg-task-accent/90" onClick={() => { setLoading(true); setOpen(true); }} title="Assign a task by voice"><Mic className="size-6" /></Button>
      </div>}
      {open && loading ? <div className={position}>
        <span aria-label="Opening voice task" className="flex size-14 items-center justify-center rounded-full bg-task-accent text-task-text shadow-xl" role="status"><Loader2 className="size-6 animate-spin" /></span>
      </div> : null}
      {open ? <Suspense fallback={null}><GlobalVoiceTaskComposer onClose={close} onReady={ready} profile={profile} /></Suspense> : null}
    </>
  );
}
