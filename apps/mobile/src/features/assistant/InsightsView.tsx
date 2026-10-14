import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KIARA_CLASSIFICATION_LABELS, kiaraDateTime, kiaraPlural, kiaraShortDay, type KiaraClassification } from "@jewelos/core";
import { getKiaraInsights, type KiaraInsightFilters, type KiaraInsightRow, type KiaraInsightsView } from "@jewelos/data/assistant/insights";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { makeStyles } from "@/theme/makeStyles";
import { Banner, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

const CLASS_TONES: Readonly<Record<KiaraClassification, "primary" | "neutral" | "success">> = {
  fresher: "primary",
  experienced: "neutral",
  veteran: "success",
};

const CLASS_OPTIONS = [
  { value: "", label: "All" },
  { value: "fresher", label: "Fresher" },
  { value: "experienced", label: "Experienced" },
  { value: "veteran", label: "Veteran" },
  { value: "insufficient_data", label: "Not enough questions yet" },
] as const;

/**
 * Insights (assistant.view_insights), read-only on Android: the same rows and
 * wording as web. The database returns only people this user may see (admins
 * the company, managers their reports-to tree), never the viewer's own row and
 * never question text. "Refresh insights now" stays on the web.
 */
export function InsightsView() {
  const styles = useStyles();
  const [filters, setFilters] = useState<KiaraInsightFilters>({ sort: "rating" });
  const [view, setView] = useState<KiaraInsightsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setView(await getKiaraInsights(filters));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Insights could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { void reload(); }, [reload]);

  const set = (key: keyof KiaraInsightFilters, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined }));
  const scope = view ? ` You see ${view.scope === "tenant" ? "everyone in the company" : "the people who report to you"}, never yourself.` : "";

  return (
    <View style={styles.list}>
      <Banner>{`AI estimate from Ask Kiara questions in the last ${view?.windowDays ?? 60} days, to plan SOP training. It is not a performance appraisal. Nobody, including Super Admin, can read the questions themselves.${scope}`}</Banner>
      <OptionPicker
        label="Branch"
        onChange={(selected) => set("branch_id", selected[0] ?? "")}
        options={[{ value: "", label: "All branches" }, ...(view?.branches ?? []).map((branch) => ({ value: branch.id, label: branch.name }))]}
        selected={[filters.branch_id ?? ""]}
      />
      <OptionPicker
        label="Department"
        onChange={(selected) => set("department_id", selected[0] ?? "")}
        options={[{ value: "", label: "All departments" }, ...(view?.departments ?? []).map((department) => ({ value: department.id, label: department.name }))]}
        selected={[filters.department_id ?? ""]}
      />
      <OptionPicker label="Class" onChange={(selected) => set("classification", selected[0] ?? "")} options={CLASS_OPTIONS} selected={[filters.classification ?? ""]} />
      <OptionPicker
        label="Sort by"
        onChange={(selected) => set("sort", selected[0] ?? "rating")}
        options={[{ value: "rating", label: "Rating" }, { value: "activity", label: "Activity" }]}
        selected={[filters.sort ?? "rating"]}
      />
      {view?.lastComputedAt ? <Text tone="muted" variant="caption">Last updated {kiaraDateTime(view.lastComputedAt)}. Updated every night.</Text> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {loading && !view ? <LoadingState /> : null}
      {view && view.rows.length === 0 && !loading ? <Text tone="muted" variant="small">No insights yet. People appear here after they ask Kiara questions and the nightly job has run.</Text> : null}
      {(view?.rows ?? []).map((row) => <InsightCard key={row.user_profile_id} minActiveDays={view?.minActiveDays ?? 4} minSopQuestions={view?.minSopQuestions ?? 8} row={row} />)}
    </View>
  );
}

function InsightCard({ row, minSopQuestions, minActiveDays }: { row: KiaraInsightRow; minSopQuestions: number; minActiveDays: number }) {
  const styles = useStyles();
  const lastActive = kiaraShortDay(row.last_active_on);
  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text weight="semibold">{row.name}</Text>
          <Text tone="muted" variant="caption">{[row.designation, row.department, row.branch].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
        {row.status === "rated" && row.classification ? (
          <View style={styles.rating}>
            <Text accessibilityLabel={`SOP knowledge ${row.rating} out of 5`} variant="small" weight="semibold">{row.rating}/5</Text>
            <StatusBadge label={KIARA_CLASSIFICATION_LABELS[row.classification]} tone={CLASS_TONES[row.classification]} />
          </View>
        ) : <StatusBadge label="Not enough questions yet" tone="neutral" />}
      </View>
      {row.summary ? <Text variant="small">{row.summary}</Text> : null}
      <Text tone="muted" variant="caption">
        {kiaraPlural(row.sop_question_count, "SOP question")} on {kiaraPlural(row.active_days, "day")} · {kiaraPlural(row.question_count, "question")} in all
        {lastActive ? ` · last active ${lastActive}` : ""}
      </Text>
      {row.status === "rated"
        ? <Text tone="muted" variant="caption">Basic questions {row.basic_count} · asked again on another day {row.repeat_count} · sent to a person {row.escalated_count}</Text>
        : <Text tone="muted" variant="caption">A rating needs at least {minSopQuestions} SOP questions on {minActiveDays} different days.</Text>}
      {row.top_topics.length ? <Text variant="caption"><Text tone="muted" variant="caption" weight="semibold">Asks most about: </Text>{row.top_topics.join(", ")}</Text> : null}
      {row.top_documents.length ? <Text variant="caption"><Text tone="muted" variant="caption" weight="semibold">SOPs used most: </Text>{row.top_documents.join(", ")}</Text> : null}
      {row.top_departments.length ? <Text variant="caption"><Text tone="muted" variant="caption" weight="semibold">SOP departments: </Text>{row.top_departments.join(", ")}</Text> : null}
    </Card>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  list: { gap: theme.space.md },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  rating: { alignItems: "flex-end", gap: theme.space.xs },
}));
