import { useCallback, useEffect, useState } from "react";
import { acknowledgeEditableSnapshot, receiveEditableSnapshot, type EditableSnapshot } from "@jewelos/core";

/** Presentation draft only; reads and saves still use the settings API. */
export function useSyncedDraft<T>(incoming: T, identity = "default") {
  const [stored, setState] = useState<EditableSnapshot<T> & { identity: string }>({ value: incoming, baseline: incoming, identity });
  const state = stored.identity === identity ? stored : { value: incoming, baseline: incoming, identity };
  // Reset synchronously so no render labels branch B while exposing branch A's values.
  if (stored.identity !== identity) setState(state);
  useEffect(() => { setState((current) => current.identity === identity ? { ...receiveEditableSnapshot(current, incoming), identity } : current); }, [incoming, identity]);
  const setValue = useCallback((value: T) => {
    setState((current) => current.identity === identity ? { ...current, value } : current);
  }, [identity]);
  // Only acknowledge the submitted value, so edits made during a save stay dirty.
  const saved = useCallback((submitted: T, confirmed = submitted, rebase?: (value: T) => T) => { setState((current) => current.identity === identity ? { ...acknowledgeEditableSnapshot(current, submitted, confirmed, rebase), identity } : current); }, [identity]);
  const discard = useCallback(() => { setState({ value: incoming, baseline: incoming, identity }); }, [incoming, identity]);
  const changedRemotely = JSON.stringify(incoming) !== JSON.stringify(state.baseline);
  return { value: state.value, setValue, saved, discard, changedRemotely };
}
