import { useEffect, useMemo, useState } from "react";
import { Linking, RefreshControl, StyleSheet, View } from "react-native";
import { FileBarChart, Upload } from "lucide-react-native";
import { parseReportFilters, reportsForRole, type ReportDefinition, type ReportFilters } from "@jewelos/core";
import { fetchReportingOptions } from "@jewelos/data/analytics/api";
import { cancelExport, fetchReport, requestExport, retryExport, signedExportUrl, type ReportCell, type ReportPayload } from "@jewelos/data/reports/api";
import { hasPermission } from "@jewelos/core";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { DateField } from "@/forms/DateField";
import { formatDateTime, titleCase } from "@/lib/format";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const initialFilters = (definition: ReportDefinition): ReportFilters => parseReportFilters({ from: iso(new Date(Date.now() - 29 * DAY)), to: iso(new Date()), page: "1", page_size: "25" }, definition);
const renderCell = (value: ReportCell): string => {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-IN") : value.toFixed(1);
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value, "—");
  return titleCase(value);
};

export function ReportsScreen() {
  const profile = useProfile();
  const access = useAccess();
  const theme = useAppTheme();
  const styles = useStyles();
  const catalog = useMemo(() => reportsForRole(profile.user_role), [profile.user_role]);
  const [definition, setDefinition] = useState(catalog[0]!);
  const [filters, setFilters] = useState<ReportFilters>(() => initialFilters(catalog[0]!));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const elevated = ["super_admin", "admin", "manager", "hr"].includes(profile.user_role);
  const canSelectBranch = ["super_admin", "admin"].includes(profile.user_role);
  const { data, error, loading, refreshing, refresh, reload } = useAsyncData(async () => {
    const [preview, history, options] = await Promise.all([
      fetchReport(definition.key, filters),
      fetchReport("export_history", { ...filters, page: 1, page_size: 25 }),
      elevated ? fetchReportingOptions() : Promise.resolve({ branches: [], departments: [] }),
    ]);
    return { preview, history, options };
  }, [definition.key, elevated, filters]);

  useEffect(() => {
    if (!data?.history.rows.some((row) => row.status === "queued" || row.status === "processing")) return undefined;
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [data?.history.rows, refresh]);

  const changeFilter = (key: keyof ReportFilters, value: string | number | undefined) => setFilters((current) => ({ ...current, [key]: value || undefined, page: key === "page" ? Number(value) : 1 }));
  const changeReport = (key: string) => {
    const next = catalog.find((item) => item.key === key);
    if (!next) return;
    setDefinition(next);
    setFilters(initialFilters(next));
  };
  const exportReport = async () => {
    setBusy("export"); setMessage(null); setActionError(null);
    try { await requestExport(definition.key, filters); setMessage("CSV export queued. Progress appears below."); await refresh(); }
    catch (caught) { setActionError(errorText(caught)); } finally { setBusy(null); }
  };
  const exportAction = async (action: "cancel" | "retry" | "download", id: string) => {
    setBusy(id); setMessage(null); setActionError(null);
    try {
      if (action === "cancel") await cancelExport(id);
      else if (action === "retry") await retryExport(id);
      else await Linking.openURL(await signedExportUrl(id));
      setMessage(action === "download" ? "Short-lived download authorized." : `Export ${action} request accepted.`);
      await refresh();
    } catch (caught) { setActionError(errorText(caught)); } finally { setBusy(null); }
  };

  if (loading) return <LoadingState label="Loading reports..." />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} title="Could not load reports" />;
  const preview = data?.preview as ReportPayload;
  const history = data?.history as ReportPayload;
  const totalPages = Math.max(1, Math.ceil(preview.total / filters.page_size));
  const departments = (data?.options.departments ?? []).filter((item) => !filters.branch_id || item.branch_id === null || item.branch_id === filters.branch_id);

  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={theme.colors.primary} />} scroll>
    <View style={styles.titleRow}><FileBarChart color={theme.colors.primary} size={24} /><View style={styles.titleCopy}><Text variant="heading" weight="bold">Reports & Exports</Text><Text tone="muted" variant="small">Role-authorized reports with bounded previews and private CSV exports.</Text></View></View>
    {message ? <Banner tone="success">{message}</Banner> : null}{actionError ? <Banner tone="danger">{actionError}</Banner> : null}
    <Card>
      <Text tone="muted" variant="label">Report</Text><OptionPicker label="Report" onChange={(selected) => changeReport(selected[0] ?? "")} options={catalog.map((item) => ({ value: item.key, label: item.name }))} selected={[definition.key]} />
      <View style={styles.fields}><View style={styles.field}><Text tone="muted" variant="label">From</Text><DateField disabled={false} invalid={false} label="Report from date" mode="date" onChange={(value) => changeFilter("from", value)} value={filters.from ?? null} /></View><View style={styles.field}><Text tone="muted" variant="label">To</Text><DateField disabled={false} invalid={false} label="Report to date" mode="date" onChange={(value) => changeFilter("to", value)} value={filters.to ?? null} /></View></View>
      {canSelectBranch && definition.filters.includes("branch_id") ? <OptionPicker label="Branch context" onChange={(selected) => { changeFilter("branch_id", selected[0]); changeFilter("department_id", undefined); }} options={[{ value: "", label: "All authorized branches" }, ...(data?.options.branches ?? []).map((item) => ({ value: item.id, label: item.name }))]} selected={[filters.branch_id ?? ""]} /> : null}
      {elevated && definition.filters.includes("department_id") ? <OptionPicker label="Department context" onChange={(selected) => changeFilter("department_id", selected[0])} options={[{ value: "", label: "All authorized departments" }, ...departments.map((item) => ({ value: item.id, label: item.name }))]} selected={[filters.department_id ?? ""]} /> : null}
      <View style={styles.fields}><View style={styles.field}><TextField autoCapitalize="none" label="Status" onChangeText={(value) => changeFilter("status", value.toLowerCase().replace(/\s+/g, "_"))} placeholder="All" value={filters.status ?? ""} /></View><View style={styles.field}><Text tone="muted" variant="label">Rows per page</Text><OptionPicker label="Rows per page" onChange={(selected) => changeFilter("page_size", Number(selected[0]))} options={[10, 25, 50, 100].map((size) => ({ value: String(size), label: String(size) }))} selected={[String(filters.page_size)]} /></View></View>
      <Text tone="muted" variant="caption">Maximum date range: {definition.maxDateRangeDays} days.</Text>
      {definition.exportEligible && hasPermission(access, "reports.export") ? <Button busy={busy === "export"} icon={<Upload color={theme.colors.onPrimary} size={18} />} label="Request CSV export" onPress={() => void exportReport()} /> : null}
    </Card>
    <View style={styles.sectionHeading}><Text variant="title" weight="semibold">{definition.name}</Text><Text tone="muted" variant="small">{preview.total.toLocaleString("en-IN")} authorized row{preview.total === 1 ? "" : "s"}</Text></View>
    {preview.rows.length === 0 ? <Card><Text style={styles.centered} tone="muted">No authorized rows match these filters.</Text></Card> : preview.rows.map((row, index) => <Card key={String(row[definition.columns[0]!.key] ?? index)}>{definition.columns.map((column) => <CardRow key={column.key} label={column.label} value={renderCell(row[column.key] ?? null)} />)}</Card>)}
    <View style={styles.pagination}><Button disabled={filters.page <= 1} label="Previous" onPress={() => changeFilter("page", filters.page - 1)} variant="secondary" /><Text tone="muted" variant="caption">Page {filters.page} of {totalPages}</Text><Button disabled={filters.page >= totalPages} label="Next" onPress={() => changeFilter("page", filters.page + 1)} variant="secondary" /></View>
    <View style={styles.sectionHeading}><Text variant="title" weight="semibold">Export history</Text><Text tone="muted" variant="small">Private files expire automatically.</Text></View>
    {history.rows.length === 0 ? <Card><Text style={styles.centered} tone="muted">No exports in this date range.</Text></Card> : history.rows.map((row) => {
      const id = String(row.export_id); const status = String(row.status);
      return <Card key={id}><View style={styles.exportHeading}><Text weight="semibold">{titleCase(String(row.report_key))}</Text><StatusBadge label={titleCase(status)} tone={status === "completed" ? "success" : status === "failed" || status === "cancelled" || status === "expired" ? "danger" : "warning"} /></View><Text tone="muted" variant="caption">Requested {renderCell(row.requested_at ?? null)} · {renderCell(row.progress_percent ?? null)}% · {renderCell(row.row_count ?? null)} rows</Text><View style={styles.actions}>{status === "completed" ? <Button busy={busy === id} label="Download" onPress={() => void exportAction("download", id)} variant="secondary" /> : null}{status === "queued" || status === "processing" ? <Button busy={busy === id} label="Cancel" onPress={() => void exportAction("cancel", id)} variant="danger" /> : null}{status === "failed" || status === "expired" ? <Button busy={busy === id} label="Retry" onPress={() => void exportAction("retry", id)} variant="secondary" /> : null}</View></Card>;
    })}
  </Screen>;
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm }, titleCopy: { flex: 1, minWidth: 0, gap: 2 }, fields: { flexDirection: "row", gap: theme.space.sm }, field: { flex: 1, minWidth: 0 }, sectionHeading: { gap: 2, marginTop: theme.space.sm }, centered: { textAlign: "center" }, pagination: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.space.sm }, exportHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.space.sm }, actions: { flexDirection: "row", gap: theme.space.sm },
}));
