import { describe, expect, it } from "vitest";
import {
  appendKiaraTranscript, kiaraComposerDisabledReason, kiaraDateTime, kiaraLocation, kiaraPlural, kiaraRelativeAge, kiaraShortDay,
} from "./screen.ts";

describe("kiaraLocation", () => {
  it("reads notification links and falls back to the chat", () => {
    expect(kiaraLocation("?conversation=c1")).toEqual({ tab: "chat", escalationId: null, conversationId: "c1" });
    expect(kiaraLocation("tab=questions&escalation=e1")).toEqual({ tab: "questions", escalationId: "e1", conversationId: null });
    expect(kiaraLocation("?tab=bogus")).toEqual({ tab: "chat", escalationId: null, conversationId: null });
    expect(kiaraLocation("")).toEqual({ tab: "chat", escalationId: null, conversationId: null });
  });
});

describe("appendKiaraTranscript (voice never sends)", () => {
  it("adds spoken words after typed text within the limit", () => {
    expect(appendKiaraTranscript("", "  aaj kya pending hai ", 2000)).toBe("aaj kya pending hai");
    expect(appendKiaraTranscript("Mera ", "leave balance?", 2000)).toBe("Mera leave balance?");
    expect(appendKiaraTranscript("abc", "defgh", 6)).toBe("abc de");
    expect(appendKiaraTranscript("typed", "   ", 2000)).toBe("typed");
  });
});

describe("kiaraComposerDisabledReason", () => {
  const base = { activeConversationId: null, questionCount: 0, conversationLimit: 15 };
  it("locks for the daily limit with the reset time, and for a full chat", () => {
    expect(kiaraComposerDisabledReason({ ...base, quota: { used: 10, limit: 10, resets_at: "2026-10-13T18:30:00.000Z", timezone: "Asia/Kolkata" } }))
      .toBe("You have used all 10 questions for today. They reset at 12:00 am on 14 Oct.");
    expect(kiaraComposerDisabledReason({ ...base, quota: null, activeConversationId: "c1", questionCount: 15 })).toBe("This chat is full. Press \"New chat\" to keep asking.");
  });
  it("stays open for unlimited users and new chats", () => {
    expect(kiaraComposerDisabledReason({ ...base, quota: { used: 99, limit: null, resets_at: "2026-10-13T18:30:00.000Z" } })).toBeNull();
    expect(kiaraComposerDisabledReason({ ...base, quota: null, questionCount: 15 })).toBeNull();
  });
});

describe("dates", () => {
  it("formats ages, times and days", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(kiaraRelativeAge("2026-10-13T11:59:50Z", now)).toBe("just now");
    expect(kiaraRelativeAge("2026-10-13T11:30:00Z", now)).toBe("30 min ago");
    expect(kiaraRelativeAge("2026-10-13T09:00:00Z", now)).toBe("3 h ago");
    expect(kiaraRelativeAge("2026-10-12T12:00:00Z", now)).toBe("1 day ago");
    expect(kiaraDateTime(null)).toBeNull();
    expect(kiaraDateTime("nope")).toBeNull();
    expect(kiaraShortDay("2026-10-12")).toBe("12 Oct");
    expect(kiaraPlural(1, "day")).toBe("1 day");
    expect(kiaraPlural(2, "day")).toBe("2 days");
  });
});
