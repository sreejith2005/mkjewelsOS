import { describe, expect, it } from "vitest";
import {
  KIARA_INSIGHTS_FORMULA_VERSION,
  classifyRating,
  computeKiaraInsight,
  kiaraInsightRating,
  kiaraInsightScore,
  parseKiaraLabelOutput,
  type KiaraInsightFact,
} from "./insights.ts";

const sop = (day: number, level: "basic" | "intermediate" | "advanced", topic: string, escalated = false): KiaraInsightFact => ({
  local_date: `2026-10-${String(day).padStart(2, "0")}`,
  category: "sop",
  sop_level: level,
  topic,
  escalated,
});

describe("Kiara insights rating (formula version 1)", () => {
  it("needs at least 8 SOP questions on at least 4 days", () => {
    const sevenQuestions = [1, 2, 3, 4, 5, 6, 7].map((day) => sop(day, "advanced", `t${day}`));
    expect(computeKiaraInsight(sevenQuestions)).toMatchObject({ status: "insufficient_data", rating: null, classification: null, sop_question_count: 7 });
    const threeDays = [1, 1, 1, 2, 2, 2, 3, 3, 3].map((day, index) => sop(day, "advanced", `t${index}`));
    expect(computeKiaraInsight(threeDays)).toMatchObject({ status: "insufficient_data", active_days: 3, sop_question_count: 9 });
    const enough = [1, 1, 2, 2, 3, 3, 4, 4].map((day, index) => sop(day, "advanced", `t${index}`));
    expect(computeKiaraInsight(enough)).toMatchObject({ status: "rated", rating: 5, classification: "veteran", formula_version: KIARA_INSIGHTS_FORMULA_VERSION });
  });

  it("does not count non-SOP questions towards the minimum, but counts them as activity", () => {
    const facts: KiaraInsightFact[] = [
      ...[1, 2, 3, 4, 5, 6, 7].map((day) => sop(day, "advanced", `t${day}`)),
      { local_date: "2026-10-09", category: "data", sop_level: null, topic: "My tasks", escalated: false },
      { local_date: "2026-10-10", category: null, sop_level: null, topic: null, escalated: false },
    ];
    const result = computeKiaraInsight(facts);
    expect(result).toMatchObject({ status: "insufficient_data", question_count: 9, sop_question_count: 7, last_active_on: "2026-10-10" });
  });

  it("matches hand-computed ratings", () => {
    // 8 questions on 4 days: 4 basic, topic "leave" on days 1 and 2 (2 repeats), 1 escalated.
    // score = 5 - 2.5*0.5 - 1.5*0.25 - 1*0.125 = 3.25 -> 3 Experienced.
    const facts = [
      sop(1, "basic", "Leave"), sop(2, "basic", " leave "), sop(2, "basic", "Uniform"), sop(3, "basic", "Billing", true),
      sop(3, "advanced", "Gold rate"), sop(4, "intermediate", "Hallmark"), sop(4, "advanced", "Exchange"), sop(1, "advanced", "Returns"),
    ];
    const result = computeKiaraInsight(facts);
    expect(result).toMatchObject({ status: "rated", rating: 3, classification: "experienced", basic_count: 4, repeat_count: 2, escalated_count: 1 });
    expect(result.top_topics[0]).toBe("Leave");

    // All basic, every topic repeated, every question escalated: 5-2.5-1.5-1 = 0 -> clamped to 1 Fresher.
    const worst = [1, 2, 3, 4, 1, 2, 3, 4].map((day) => sop(day, "basic", "Same", true));
    expect(computeKiaraInsight(worst)).toMatchObject({ rating: 1, classification: "fresher", repeat_count: 8 });
  });

  it("clamps the score and rounds half up", () => {
    expect(kiaraInsightScore({ basic: 1, repeat: 1, escalation: 1 })).toBe(1);
    expect(kiaraInsightScore({ basic: 0, repeat: 0, escalation: 0 })).toBe(5);
    expect(kiaraInsightScore({ basic: 0.5, repeat: 0, escalation: 0 })).toBe(3.75);
    expect(kiaraInsightRating(3.5)).toBe(4);
    expect(kiaraInsightRating(3.4999999999)).toBe(4);
    expect(kiaraInsightRating(3.49)).toBe(3);
    expect(kiaraInsightRating(2.5)).toBe(3);
    expect(kiaraInsightRating(1.2)).toBe(1);
    expect(kiaraInsightRating(9)).toBe(5);
    expect(kiaraInsightRating(-2)).toBe(1);
  });

  it("maps ratings to class bands", () => {
    expect([1, 2, 3, 4, 5].map(classifyRating)).toEqual(["fresher", "fresher", "experienced", "veteran", "veteran"]);
  });

  it("ranks the SOPs and departments asked about most", () => {
    const facts: KiaraInsightFact[] = [
      { ...sop(1, "basic", "a"), documents: ["Driver SOP", "Leave policy"], departments: ["Drivers"] },
      { ...sop(2, "basic", "b"), documents: ["Driver SOP"], departments: ["Drivers", "Sales"] },
      { ...sop(3, "basic", "c"), documents: ["driver sop"] },
    ];
    const result = computeKiaraInsight(facts);
    expect(result.top_documents).toEqual(["Driver SOP", "Leave policy"]);
    expect(result.top_departments).toEqual(["Drivers", "Sales"]);
  });
});

describe("Kiara labelling output", () => {
  const ok = {
    summary: "Mostly asks about  leave and uniforms.",
    questions: [
      { id: "q1", category: "sop", sop_level: "basic", topic: " Leave  policy " },
      { id: "q2", category: "data", sop_level: "advanced", topic: "My tasks" },
    ],
  };

  it("accepts a complete answer and normalises it", () => {
    expect(parseKiaraLabelOutput(ok, ["q1", "q2"])).toEqual({
      summary: "Mostly asks about leave and uniforms.",
      questions: [
        { id: "q1", category: "sop", sop_level: "basic", topic: "Leave policy" },
        // A level only applies to SOP questions.
        { id: "q2", category: "data", sop_level: null, topic: "My tasks" },
      ],
    });
  });

  it("rejects missing, unknown, duplicate, or malformed items", () => {
    expect(parseKiaraLabelOutput(ok, ["q1", "q2", "q3"])).toBeNull();
    expect(parseKiaraLabelOutput(ok, ["q1"])).toBeNull();
    expect(parseKiaraLabelOutput({ ...ok, questions: [ok.questions[0], ok.questions[0]] }, ["q1"])).toBeNull();
    expect(parseKiaraLabelOutput({ ...ok, questions: [{ ...ok.questions[0], category: "gossip" }] }, ["q1"])).toBeNull();
    expect(parseKiaraLabelOutput({ ...ok, questions: [{ ...ok.questions[0], sop_level: "expert" }] }, ["q1"])).toBeNull();
    expect(parseKiaraLabelOutput({ ...ok, summary: "" }, ["q1", "q2"])).toBeNull();
    expect(parseKiaraLabelOutput({ ...ok, summary: "x".repeat(301) }, ["q1", "q2"])).toBeNull();
    expect(parseKiaraLabelOutput("not json", ["q1"])).toBeNull();
  });
});
