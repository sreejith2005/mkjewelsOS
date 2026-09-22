import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { UserProfile } from "@/types";
import { createDelegationTask, loadTaskAuthoringReferenceData, uploadTaskAttachment, type TaskReferenceData } from "./api";
import { TaskComposer } from "./TaskComposer";

/**
 * The Tasks page composer, opened from the app-wide voice button. It uses the
 * same reference data, save path, and attachment upload as the Tasks page, so
 * a task assigned from here is indistinguishable from one assigned there.
 */
export function GlobalVoiceTaskComposer({ onClose, onReady, profile }: {
  onClose: () => void;
  onReady: () => void;
  profile: UserProfile;
}) {
  const [references, setReferences] = useState<TaskReferenceData | null>(null);

  useEffect(() => {
    let active = true;
    loadTaskAuthoringReferenceData()
      .then((data) => { if (active) setReferences(data); })
      .catch((caught: unknown) => {
        if (!active) return;
        toast.error(caught instanceof Error ? caught.message : "Unable to load task authoring options");
        onClose();
      })
      .finally(() => { if (active) onReady(); });
    return () => { active = false; };
  }, [onClose, onReady]);

  if (!references) return null;
  return <TaskComposer canUseVoice data={references} onClose={onClose} onCreated={onClose} onSave={createDelegationTask} onUploadAttachment={(taskId, file) => uploadTaskAttachment(profile.tenant_id, taskId, file)} profile={profile} />;
}
