import {
  interpretTaskVoiceNote as interpretSharedTaskVoiceNote,
  type VoiceTaskInterpretation,
} from "@jewelos/data/tasks/voice";

export type { VoiceTaskInterpretation } from "@jewelos/data/tasks/voice";

/**
 * Sends a recording for transcription and interpretation. This returns a draft
 * for the composer to prefill; it never creates a task. The author still
 * submits through `createDelegationTask`, which is the audited write path.
 */
export async function interpretTaskVoiceNote(recording: Blob, filename: string): Promise<VoiceTaskInterpretation> {
  return interpretSharedTaskVoiceNote({
    body: recording,
    name: filename,
    size: recording.size,
    type: recording.type,
  });
}
