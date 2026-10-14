import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION_CONTROLS, builtinAccessContext, type AccessContext, type SectionControls, type UserRole } from "@jewelos/core";
import type { AskKiaraOutcome } from "@jewelos/data/assistant/api";
import {
  KIARA_PRODUCTION_WEB_ORIGIN, canUseKiaraVoice, kiaraBadgeEnabled, kiaraBadgeLabel, kiaraNativeLinkTarget, kiaraTabs, kiaraWebUrl,
  keyboardOverlap, shouldRetryAsJson, visibleKiaraTab,
} from "./askKiaraModel";

const accessFor = (role: UserRole): AccessContext => builtinAccessContext({ id: `profile-${role}`, user_role: role });
const withPermission = (access: AccessContext, key: string, value: boolean): AccessContext => ({ ...access, permissions: { ...access.permissions, [key]: value } });
const sectionOff: SectionControls = { ...DEFAULT_SECTION_CONTROLS, section_availability: { ...DEFAULT_SECTION_CONTROLS.section_availability, ask_kiara: false } };

describe("tabs", () => {
  it("gives staff the chat only", () => {
    expect(kiaraTabs(accessFor("staff")).map((tab) => tab.id)).toEqual(["chat"]);
  });

  it("follows each permission, and marks Knowledge base and Limits as web-only", () => {
    let access = accessFor("staff");
    for (const key of ["assistant.answer_escalations", "assistant.manage_knowledge", "assistant.view_insights", "assistant.manage_limits"]) access = withPermission(access, key, true);
    expect(kiaraTabs(access)).toEqual([
      { id: "chat", label: "Chat", webOnly: false },
      { id: "questions", label: "Questions for you", webOnly: false },
      { id: "knowledge", label: "Knowledge base", webOnly: true },
      { id: "insights", label: "Insights", webOnly: false },
      { id: "limits", label: "Limits", webOnly: true },
    ]);
  });

  it("shows the chat for a link to a tab the user does not have", () => {
    expect(visibleKiaraTab(accessFor("staff"), "questions")).toBe("chat");
    expect(visibleKiaraTab(withPermission(accessFor("staff"), "assistant.answer_escalations", true), "questions")).toBe("questions");
  });

  it("opens the web page for the admin tabs", () => {
    expect(kiaraWebUrl(null, "knowledge")).toBe(`${KIARA_PRODUCTION_WEB_ORIGIN}/ask-kiara?tab=knowledge`);
    expect(kiaraWebUrl("https://mkjewels-os.vercel.app/", "limits")).toBe("https://mkjewels-os.vercel.app/ask-kiara?tab=limits");
    expect(kiaraWebUrl("https://mkjewels-os.vercel.app")).toBe("https://mkjewels-os.vercel.app/ask-kiara");
  });
});

describe("voice mic", () => {
  it("shows the mic only with assistant.voice", () => {
    expect(canUseKiaraVoice(withPermission(accessFor("staff"), "assistant.voice", false))).toBe(false);
    expect(canUseKiaraVoice(withPermission(accessFor("staff"), "assistant.voice", true))).toBe(true);
    expect(canUseKiaraVoice(withPermission(accessFor("manager"), "assistant.voice", false))).toBe(false);
  });
});

describe("badge", () => {
  const answerer = withPermission(accessFor("staff"), "assistant.answer_escalations", true);
  it("counts for answerers who can open the section", () => {
    expect(kiaraBadgeEnabled({ access: answerer, controls: DEFAULT_SECTION_CONTROLS })).toBe(true);
    expect(kiaraBadgeEnabled({ access: withPermission(accessFor("staff"), "assistant.answer_escalations", false), controls: DEFAULT_SECTION_CONTROLS })).toBe(false);
    expect(kiaraBadgeEnabled({ access: withPermission(answerer, "assistant.view", false), controls: DEFAULT_SECTION_CONTROLS })).toBe(false);
  });
  it("is off while the section is switched off for a non-developer", () => {
    expect(kiaraBadgeEnabled({ access: answerer, controls: sectionOff })).toBe(false);
  });
  it("labels counts", () => {
    expect(kiaraBadgeLabel(0)).toBeNull();
    expect(kiaraBadgeLabel(3)).toBe("3");
    expect(kiaraBadgeLabel(120)).toBe("99+");
  });
});

describe("links in answers", () => {
  it("opens CRM record and list links on the CRM tab, others as written", () => {
    expect(kiaraNativeLinkTarget("/crm/clients/3f2a1b9c-1d2e-4f50-8a6b-426614174000")).toBe("/crm");
    expect(kiaraNativeLinkTarget("/crm/followups")).toBe("/crm");
    expect(kiaraNativeLinkTarget("/availability")).toBe("/availability");
    expect(kiaraNativeLinkTarget("/tasks?tab=delegated")).toBe("/tasks?tab=delegated");
  });
});

describe("keyboard", () => {
  it("lifts the composer by the overlap only", () => {
    expect(keyboardOverlap(800, null)).toBe(0);
    expect(keyboardOverlap(800, 500)).toBe(300);
    expect(keyboardOverlap(480, 500)).toBe(0);
  });
});

describe("streaming fallback", () => {
  const failed = (extra: Partial<Extract<AskKiaraOutcome, { ok: false }>> = {}): AskKiaraOutcome => ({ ok: false, requestId: "r", code: "unavailable", message: "x", conversationId: null, ...extra });
  it("retries as JSON only when the connection itself failed before Kiara started", () => {
    expect(shouldRetryAsJson(failed({ transport: true }), false)).toBe(true);
    expect(shouldRetryAsJson(failed({ transport: true }), true)).toBe(false);
    expect(shouldRetryAsJson(failed(), false)).toBe(false);
    expect(shouldRetryAsJson(failed({ code: "daily_limit_reached" }), false)).toBe(false);
  });
});
