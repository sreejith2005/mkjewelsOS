/**
 * Ask Kiara employee insights (spec 5.5 and 13). Pure rules shared by the
 * kiara-insights worker (rating), the web Insights tab (labels), and tests.
 *
 * Formula version 1, over the SOP questions of the last 60 days:
 *   n = SOP questions, d = distinct days with an SOP question.
 *   Minimum activity: n >= 8 and d >= 4, otherwise "insufficient_data".
 *   score = 5 - 2.5 * basic_share - 1.5 * repeat_share - 1.0 * escalation_share,
 *   clamped to 1..5 and rounded to a whole number (the rating).
 *   Rating 1-2 Fresher, 3 Experienced, 4-5 Veteran.
 */

export const KIARA_INSIGHTS_FORMULA_VERSION = 1;
export const KIARA_INSIGHTS_WINDOW_DAYS = 60;
export const KIARA_INSIGHTS_MIN_SOP_QUESTIONS = 8;
export const KIARA_INSIGHTS_MIN_ACTIVE_DAYS = 4;

export const KIARA_QUESTION_CATEGORIES = ["sop", "app_help", "data", "other"] as const;
export type KiaraQuestionCategory = (typeof KIARA_QUESTION_CATEGORIES)[number];
export const KIARA_SOP_LEVELS = ["basic", "intermediate", "advanced"] as const;
export type KiaraSopLevel = (typeof KIARA_SOP_LEVELS)[number];
export const KIARA_CLASSIFICATIONS = ["fresher", "experienced", "veteran"] as const;
export type KiaraClassification = (typeof KIARA_CLASSIFICATIONS)[number];
export type KiaraInsightStatus = "rated" | "insufficient_data";

export const KIARA_CLASSIFICATION_LABELS: Readonly<Record<KiaraClassification, string>> = {
  fresher: "Fresher",
  experienced: "Experienced",
  veteran: "Veteran",
};

/** One answered question as the insights job sees it (no question text). */
export type KiaraInsightFact = Readonly<{
  /** Tenant-local date the question was asked (YYYY-MM-DD). */
  local_date: string;
  category: KiaraQuestionCategory | null;
  sop_level: KiaraSopLevel | null;
  topic: string | null;
  escalated: boolean;
  /** Titles of the SOPs Kiara cited in the answer. */
  documents?: readonly string[];
  /** Department tags of those SOPs. */
  departments?: readonly string[];
}>;

export type KiaraInsightResult = Readonly<{
  status: KiaraInsightStatus;
  rating: number | null;
  classification: KiaraClassification | null;
  /** Every answered question in the window, any category. */
  question_count: number;
  sop_question_count: number;
  active_days: number;
  basic_count: number;
  repeat_count: number;
  escalated_count: number;
  last_active_on: string | null;
  top_topics: readonly string[];
  top_documents: readonly string[];
  top_departments: readonly string[];
  formula_version: number;
}>;

/** "Leave  Policy " and "leave policy" are the same topic. */
export function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").toLowerCase();
}

export function classifyRating(rating: number): KiaraClassification {
  if (rating <= 2) return "fresher";
  if (rating === 3) return "experienced";
  return "veteran";
}

/** The raw score before rounding; exported for the formula tests. */
export function kiaraInsightScore(shares: Readonly<{ basic: number; repeat: number; escalation: number }>): number {
  const raw = 5 - 2.5 * shares.basic - 1.5 * shares.repeat - 1.0 * shares.escalation;
  return Math.min(5, Math.max(1, raw));
}

/** Clamped score rounded half up; the epsilon keeps 3.4999999 from float noise at 3.5. */
export function kiaraInsightRating(score: number): number {
  return Math.min(5, Math.max(1, Math.floor(score + 0.5 + 1e-9)));
}

function topCounts(values: readonly string[], limit: number): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const value of values) {
    const label = value.trim().replace(/\s+/g, " ");
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((entry) => entry.label);
}

/** Facts are expected to be inside the window already (the database filters them). */
export function computeKiaraInsight(facts: readonly KiaraInsightFact[]): KiaraInsightResult {
  const sop = facts.filter((fact) => fact.category === "sop");
  const n = sop.length;
  const days = new Set(sop.map((fact) => fact.local_date));
  const basic = sop.filter((fact) => fact.sop_level === "basic").length;
  const escalated = sop.filter((fact) => fact.escalated).length;
  // A topic asked on two or more different days counts every one of its questions as a repeat.
  const topicDays = new Map<string, Set<string>>();
  for (const fact of sop) {
    if (!fact.topic) continue;
    const key = normalizeTopic(fact.topic);
    if (!key) continue;
    const set = topicDays.get(key) ?? new Set<string>();
    set.add(fact.local_date);
    topicDays.set(key, set);
  }
  const repeat = sop.filter((fact) => fact.topic && (topicDays.get(normalizeTopic(fact.topic))?.size ?? 0) >= 2).length;
  const allDates = facts.map((fact) => fact.local_date).sort();
  const base = {
    question_count: facts.length,
    sop_question_count: n,
    active_days: days.size,
    basic_count: basic,
    repeat_count: repeat,
    escalated_count: escalated,
    last_active_on: allDates.length ? allDates[allDates.length - 1]! : null,
    top_topics: topCounts(sop.flatMap((fact) => (fact.topic ? [fact.topic] : [])), 3),
    top_documents: topCounts(facts.flatMap((fact) => fact.documents ?? []), 3),
    top_departments: topCounts(facts.flatMap((fact) => fact.departments ?? []), 3),
    formula_version: KIARA_INSIGHTS_FORMULA_VERSION,
  };
  if (n < KIARA_INSIGHTS_MIN_SOP_QUESTIONS || days.size < KIARA_INSIGHTS_MIN_ACTIVE_DAYS) {
    return { ...base, status: "insufficient_data", rating: null, classification: null };
  }
  const rating = kiaraInsightRating(kiaraInsightScore({ basic: basic / n, repeat: repeat / n, escalation: escalated / n }));
  return { ...base, status: "rated", rating, classification: classifyRating(rating) };
}

// ---------------------------------------------------------------------------
// Labelling output (structured output of the Batches request)
// ---------------------------------------------------------------------------

export type KiaraQuestionLabel = Readonly<{ id: string; category: KiaraQuestionCategory; sop_level: KiaraSopLevel | null; topic: string }>;
export type KiaraLabelOutput = Readonly<{ summary: string; questions: readonly KiaraQuestionLabel[] }>;

/** JSON schema for output_config.format; the same rules are re-checked by parseKiaraLabelOutput. */
export const KIARA_LABEL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "questions"],
  properties: {
    summary: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "sop_level", "topic"],
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: [...KIARA_QUESTION_CATEGORIES] },
          sop_level: { anyOf: [{ type: "string", enum: [...KIARA_SOP_LEVELS] }, { type: "null" }] },
          topic: { type: "string" },
        },
      },
    },
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates one employee's labelling result against the ids that were sent.
 * Returns null when the shape is wrong or any sent question is missing, so the
 * whole item is retried on the next run instead of being half applied.
 */
export function parseKiaraLabelOutput(value: unknown, expectedIds: readonly string[]): KiaraLabelOutput | null {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.questions)) return null;
  const summary = value.summary.trim().replace(/\s+/g, " ");
  if (!summary || summary.length > 300) return null;
  const expected = new Set(expectedIds);
  const seen = new Map<string, KiaraQuestionLabel>();
  for (const item of value.questions) {
    if (!isRecord(item) || typeof item.id !== "string" || !expected.has(item.id) || seen.has(item.id)) return null;
    if (!(KIARA_QUESTION_CATEGORIES as readonly unknown[]).includes(item.category)) return null;
    const category = item.category as KiaraQuestionCategory;
    const level = item.sop_level;
    if (level !== null && !(KIARA_SOP_LEVELS as readonly unknown[]).includes(level)) return null;
    if (typeof item.topic !== "string") return null;
    const topic = item.topic.trim().replace(/\s+/g, " ");
    if (!topic || topic.length > 120) return null;
    // A level is meaningful only for SOP questions.
    seen.set(item.id, { id: item.id, category, sop_level: category === "sop" ? (level as KiaraSopLevel | null) ?? "intermediate" : null, topic });
  }
  if (seen.size !== expected.size) return null;
  return { summary, questions: [...seen.values()] };
}
