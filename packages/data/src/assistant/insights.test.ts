import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc: api.rpc }) }));

import { asInsightRow, getKiaraInsights, insightsErrorMessage, listKiaraUsage, requestKiaraInsightsRefresh, saveKiaraSettings, saveKiaraUserLimit } from "./insights";

beforeEach(() => api.rpc.mockReset());

describe("insights data API", () => {
  it("sends only the filters that are set", async () => {
    api.rpc.mockResolvedValue({ data: { rows: [], filters: {}, scope: "tenant", refresh: { allowed: true } }, error: null });
    const view = await getKiaraInsights({ classification: "fresher", branch_id: "", sort: "activity" });
    expect(api.rpc).toHaveBeenCalledWith("get_kiara_insights", { p_filters: { classification: "fresher", sort: "activity" } });
    expect(view).toMatchObject({ scope: "tenant", windowDays: 60, minSopQuestions: 8, minActiveDays: 4, refresh: { allowed: true, nextAllowedAt: null } });
  });

  it("never shows a rating without a matching class", () => {
    expect(asInsightRow({ user_profile_id: "u1", status: "rated", rating: 4, classification: "veteran", top_topics: ["Leave", 3] }))
      .toMatchObject({ status: "rated", rating: 4, classification: "veteran", top_topics: ["Leave"] });
    expect(asInsightRow({ user_profile_id: "u1", status: "rated", rating: 4, classification: "genius" }))
      .toMatchObject({ status: "insufficient_data", rating: null, classification: null });
    expect(asInsightRow({ status: "rated" })).toBeNull();
  });

  it("explains the refresh limit and missing setup", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "kiara_insights_refresh_too_soon", details: "2026-10-12T10:00:00Z" } });
    await expect(requestKiaraInsightsRefresh()).rejects.toThrow(/less than an hour ago/);
    expect(insightsErrorMessage({ code: "P0001", message: "kiara_insights_not_configured" })).toMatch(/not set up yet/);
    expect(insightsErrorMessage({ code: "40001", message: "x" })).toMatch(/Someone else changed/);
  });

  it("saves company settings with the expected version", async () => {
    api.rpc.mockResolvedValue({ data: { daily_question_limit: 15, conversation_retention_days: 180, settings_version: 3 }, error: null });
    await expect(saveKiaraSettings({ dailyQuestionLimit: 15, conversationRetentionDays: 180, version: 2 })).resolves.toMatchObject({ dailyQuestionLimit: 15, version: 3 });
    expect(api.rpc).toHaveBeenCalledWith("save_kiara_settings_with_audit", { p_daily_limit: 15, p_retention_days: 180, p_expected_version: 2 });
  });

  it("maps each kind of personal exception", async () => {
    api.rpc.mockResolvedValue({ data: {}, error: null });
    await saveKiaraUserLimit("u1", { kind: "limit", dailyQuestionLimit: 25, reason: "  Pilot  " });
    expect(api.rpc).toHaveBeenLastCalledWith("save_kiara_user_limit_with_audit", { p_user_profile_id: "u1", p_daily_limit: 25, p_unlimited: false, p_clear: false, p_reason: "Pilot" });
    await saveKiaraUserLimit("u1", { kind: "unlimited" });
    expect(api.rpc).toHaveBeenLastCalledWith("save_kiara_user_limit_with_audit", { p_user_profile_id: "u1", p_daily_limit: null, p_unlimited: true, p_clear: false, p_reason: null });
    await saveKiaraUserLimit("u1", { kind: "clear" });
    expect(api.rpc).toHaveBeenLastCalledWith("save_kiara_user_limit_with_audit", { p_user_profile_id: "u1", p_daily_limit: null, p_unlimited: false, p_clear: true, p_reason: null });
  });

  it("reads usage defensively", async () => {
    api.rpc.mockResolvedValue({ data: { from: "2026-10-12", to: "2026-10-12", company_limit: 10, days: ["2026-10-12"],
      people: [{ user_profile_id: "u1", name: "A", limit: 10, unlimited: false, by_day: { "2026-10-12": 3, bad: "x" }, total: 3 }, { name: "no id" }],
      totals: { by_day: { "2026-10-12": 3 }, total: 3 } }, error: null });
    const usage = await listKiaraUsage();
    expect(api.rpc).toHaveBeenCalledWith("list_kiara_usage", { p_from: null, p_to: null });
    expect(usage.people).toEqual([{ userProfileId: "u1", name: "A", department: null, branch: null, limit: 10, exception: false, byDay: { "2026-10-12": 3 }, total: 3 }]);
    expect(usage.total).toBe(3);
  });
});
