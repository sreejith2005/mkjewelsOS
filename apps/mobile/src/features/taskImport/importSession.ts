export type ImportStage = "select" | "validate" | "map" | "review" | "run" | "result";
export type ImportSession = Readonly<{
  stage: ImportStage;
  fileLabel: string;
  total: number;
  unresolved: number;
  issues: number;
  processed: number;
  batchId: string | null;
  rawBytesHeld: boolean;
  result: string | null;
  error: string | null;
}>;

export type ImportSessionEvent =
  | Readonly<{ type: "selected"; fileLabel: string }>
  | Readonly<{ type: "parsed"; total: number; unresolved: number; issues: number }>
  | Readonly<{ type: "mapped"; unresolved: number }>
  | Readonly<{ type: "run"; batchId?: string }>
  | Readonly<{ type: "progress"; processed: number; batchId?: string }>
  | Readonly<{ type: "failed"; message: string }>
  | Readonly<{ type: "complete"; message: string }>
  | Readonly<{ type: "reset" }>;

export const initialImportSession: ImportSession = {
  stage: "select",
  fileLabel: "",
  total: 0,
  unresolved: 0,
  issues: 0,
  processed: 0,
  batchId: null,
  rawBytesHeld: false,
  result: null,
  error: null,
};

export function taskImportResumeOffset(session: ImportSession, batchId: string): number {
  return session.batchId === batchId ? session.processed : 0;
}

export function reduceImportSession(state: ImportSession, event: ImportSessionEvent): ImportSession {
  if (event.type === "reset") return initialImportSession;
  if (event.type === "selected") return {
    ...initialImportSession,
    stage: "validate",
    fileLabel: event.fileLabel,
    rawBytesHeld: true,
  };
  if (event.type === "parsed") return {
    ...state,
    stage: event.issues > 0 ? "validate" : event.unresolved > 0 ? "map" : "review",
    total: event.total,
    unresolved: event.unresolved,
    issues: event.issues,
    rawBytesHeld: false,
  };
  if (event.type === "mapped") return { ...state, unresolved: event.unresolved, stage: event.unresolved > 0 ? "map" : "review" };
  if (event.type === "run") return { ...state, stage: "run", error: null, batchId: event.batchId ?? state.batchId };
  if (event.type === "progress") return {
    ...state,
    processed: Math.min(
      state.total,
      event.batchId && event.batchId !== state.batchId
        ? Math.max(0, event.processed)
        : Math.max(state.processed, event.processed),
    ),
    batchId: event.batchId ?? state.batchId,
  };
  if (event.type === "failed") return { ...state, stage: "review", error: event.message, rawBytesHeld: false };
  return { ...state, stage: "result", processed: state.total, result: event.message, error: null, rawBytesHeld: false };
}
