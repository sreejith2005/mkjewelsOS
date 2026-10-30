import type { FmsWorkspaceRecord } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";

export function FmsReadState({ loading, error, retry }: { loading: boolean; error?: string | undefined; retry: () => void }) {
 if (error) return <div className="space-y-2 p-3"><Notice tone="danger">{error}</Notice><Button variant="secondary" onClick={retry}>Retry</Button></div>;
 return loading ? <div aria-label="Loading FMS work" className="m-3 h-14 animate-pulse rounded-xl bg-task-muted" /> : null;
}
/** The record's main action, named for what is actually waiting. */
export function fmsRecordAction(record: Pick<FmsWorkspaceRecord, "status" | "target">): string {
 if (record.status === "completed") return "View";
 if (record.status === "waiting") return "View details";
 return record.target.kind === "starter_form" ? "Start form" : record.target.kind === "stage_form" ? "Fill form" : "Open work";
}
