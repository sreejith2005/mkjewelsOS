"use client";

import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Branch = { id: string; name: string };

export function ExistingClientWalkinAction({
  clientId,
  primaryName,
  primaryPhone,
  role,
  branchId,
  branches,
}: {
  clientId: string;
  primaryName: string;
  primaryPhone: string;
  role: string;
  branchId: string | null;
  branches: Branch[];
}) {
  const router = useRouter();
  const [selectedBranch, setSelectedBranch] = useState(branchId ?? "");
  const [choosingBranch, setChoosingBranch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const needsBranchChoice = role === "super_admin" && !selectedBranch;

  async function launch() {
    if (needsBranchChoice) {
      setChoosingBranch(true);
      return;
    }
    setSaving(true);
    setMessage("");
    const { data, error } = await createClient().rpc("create_entry_queue", {
      p_client_name: primaryName,
      p_mobile: primaryPhone,
      p_branch_id: selectedBranch || undefined,
      p_client_id: clientId,
    });
    setSaving(false);
    if (error || !data?.[0]?.id) {
      setMessage("Could not start the walk-in entry. Check your branch access and try again.");
      return;
    }
    router.push(`/visits/new?queue=${data[0].id}`);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {choosingBranch ? (
        <label className="text-sm">
          <span className="sr-only">Walk-in branch</span>
          <select aria-label="Walk-in branch" className="rounded border p-2" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
            <option value="">Choose branch</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
      ) : null}
      <button type="button" className="underline disabled:text-stone-400" disabled={saving || (choosingBranch && !selectedBranch)} onClick={() => void launch()}>
        {saving ? "Starting walk-in…" : choosingBranch ? "Start walk-in entry" : "Make Walk-in Entry"}
      </button>
      {message ? <span role="status" className="text-sm text-red-700">{message}</span> : null}
    </span>
  );
}
