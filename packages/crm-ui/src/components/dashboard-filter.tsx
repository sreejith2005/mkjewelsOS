"use client";

import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useState } from "react";
import type { DashboardMode } from "@/lib/dashboard";

export function DashboardFilter({ mode, startDate, endDate }: { mode: DashboardMode; startDate: string; endDate: string }) {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState<DashboardMode>(mode);
  const [selectedStartDate, setSelectedStartDate] = useState(mode === "DATE_TO_DATE" ? startDate : "");
  const [selectedEndDate, setSelectedEndDate] = useState(mode === "DATE_TO_DATE" ? endDate : "");

  function apply() {
    const params = new URLSearchParams({ mode: selectedMode });
    if (selectedMode === "DATE_TO_DATE") {
      if (selectedStartDate) params.set("startDate", selectedStartDate);
      if (selectedEndDate) params.set("endDate", selectedEndDate);
    }
    router.push(`/dashboard?${params}`);
  }

  return <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3"><label className="text-sm font-medium">FILTER TYPE<select aria-label="Filter type" className="ml-2 rounded border p-2" value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as DashboardMode)}><option value="ALL">ALL DATA</option><option value="MONTH">THIS MONTH</option><option value="WEEK">THIS WEEK</option><option value="DATE_TO_DATE">DATE TO DATE</option></select></label>{selectedMode === "DATE_TO_DATE" ? <><label className="text-xs font-medium">START DATE<input aria-label="Start date" className="mt-1 block rounded border p-2 text-sm" type="date" value={selectedStartDate} onChange={(event) => setSelectedStartDate(event.target.value)} /></label><label className="text-xs font-medium">END DATE<input aria-label="End date" className="mt-1 block rounded border p-2 text-sm" type="date" value={selectedEndDate} onChange={(event) => setSelectedEndDate(event.target.value)} /></label></> : null}<button type="button" className="rounded bg-amber-800 px-3 py-2 text-sm font-medium text-white" onClick={apply}>APPLY FILTER</button></div>;
}
