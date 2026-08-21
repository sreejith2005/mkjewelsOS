import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { ClipboardPenLine, UsersRound } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Modal, Notice } from "@/components/ui";
import { ClientDetail } from "@/features/crm/ClientDetail";
import { ClientForm } from "@/features/crm/ClientForm";
import { CrmDirectory, EMPTY_FILTERS } from "@/features/crm/CrmDirectory";
import { FollowupsPanel } from "@/features/crm/FollowupsPanel";
import { MergeDialog } from "@/features/crm/MergeDialog";
import { WalkinWorkspace } from "@/features/crm/WalkinWorkspace";
import { loadClient, loadCrmOptions, searchClients } from "@/features/crm/api";
import type { CrmClientDetail, CrmClientSummary, CrmOptions } from "@/features/crm/types";

const EMPTY_OPTIONS: CrmOptions = { branches: [], profiles: [], dropdowns: [] };
type Section = "walkins" | "directory" | "followups";

const CRM_SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "walkins", label: "Client walk-in form" },
  { id: "followups", label: "Not bought follow-up" },
  { id: "directory", label: "Client database" },
];

export function CRMPage() {
  const { profile } = useAuth();
  const [section, setSection] = useState<Section>("walkins");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const deferredQuery = useDeferredValue(filters.query);
  const [items, setItems] = useState<CrmClientSummary[]>([]);
  const [options, setOptions] = useState<CrmOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrmClientDetail | null>(null);
  const [modal, setModal] = useState<"new" | "edit" | "merge" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const cursor = items.at(-1)?.next_cursor;

  const search = useCallback(async (append = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await searchClients({ ...filters, query: deferredQuery, cursor: append ? cursor : undefined, limit: 25 });
      if (sequence !== requestSequence.current) return;
      setItems((current) => append ? [...current, ...result] : result);
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : "Client search failed");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [cursor, deferredQuery, filters]);

  useEffect(() => {
    void loadCrmOptions().then(setOptions).catch((caught) => setError(caught instanceof Error ? caught.message : "CRM options failed"));
  }, []);

  useEffect(() => {
    if (section !== "directory") return;
    const timer = window.setTimeout(() => void search(false), 250);
    return () => window.clearTimeout(timer);
  }, [deferredQuery, filters.assigned_crm_id, filters.branch_id, filters.client_type_id, filters.followup_status, filters.potential_category, filters.source_id, search, section]);

  const open = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await loadClient(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Client detail failed");
    } finally {
      setLoading(false);
    }
  }, []);
  const refreshDetail = useCallback(async () => { if (detail) setDetail(await loadClient(detail.client.id)); }, [detail]);
  const completeWalkin = useCallback(async (clientId: string, summary: string) => {
    setSuccess(summary);
    setSection("directory");
    await search(false);
    await open(clientId);
  }, [open, search]);

  if (!profile) return null;

  return <section className="mx-auto max-w-7xl space-y-5">
    <header className="rounded-2xl border border-task-border bg-task-bg p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><UsersRound className="size-6 text-task-accent"/><h1 className="text-2xl font-bold text-task-text">MK Jewels CRM</h1></div>
          <p className="mt-1 text-sm text-task-text-muted">Walk-ins, client history, and follow-up work—inside JewelOS.</p>
        </div>
        <Button onClick={() => { setDetail(null); setSection("walkins"); }}><ClipboardPenLine className="size-4"/>Register walk-in</Button>
      </div>
      <nav aria-label="CRM workspace" className="mt-5 flex flex-wrap gap-2 border-t border-task-border pt-4">
        {CRM_SECTIONS.map((item) => <Button key={item.id} onClick={() => { setDetail(null); setSection(item.id); }} variant={section === item.id ? "primary" : "secondary"}>{item.label}</Button>)}
      </nav>
    </header>
    {success ? <Notice tone="success">{success}</Notice> : null}
    {detail ? <ClientDetail detail={detail} onBack={() => setDetail(null)} onEdit={() => setModal("edit")} onMerge={() => setModal("merge")} onRefresh={refreshDetail} options={options}/> : section === "walkins" ? <WalkinWorkspace onCompleted={completeWalkin} options={options}/> : section === "directory" ? <CrmDirectory error={error} filters={filters} hasMore={items.length > 0 && items.length % 25 === 0} items={items} loading={loading} onFilters={setFilters} onMore={() => void search(true)} onOpen={(id) => void open(id)} options={options}/> : <FollowupsPanel onOpenClient={(id) => void open(id)} options={options}/>}
    {modal === "new" ? <Modal onClose={() => setModal(null)} title="New client" wide><ClientForm onCancel={() => setModal(null)} onSaved={async (id) => { setModal(null); setSuccess("Client created."); await search(false); await open(id); }} options={options}/></Modal> : null}
    {modal === "edit" && detail ? <Modal onClose={() => setModal(null)} title="Edit client" wide><ClientForm client={detail.client} onCancel={() => setModal(null)} onSaved={async () => { setModal(null); setSuccess("Client updated."); await refreshDetail(); }} options={options}/></Modal> : null}
    {modal === "merge" && detail ? <MergeDialog onClose={() => setModal(null)} onMerged={async () => { setModal(null); setSuccess("Duplicate merged into the surviving client with history preserved."); await refreshDetail(); }} survivor={detail}/> : null}
  </section>;
}
