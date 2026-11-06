// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisSnapshot, ConversationCard, StoredSalesAnalysis } from "@jewelos/core";
import {
  correctTranscript, createActionTask, fetchActionTasks, fetchAnalysisSnapshot, fetchConversationCard, fetchConversationPage, fetchEvidenceAudio, fetchToday,
  requestRescore, reviewAnalysis,
} from "@jewelos/data";
import { StoreIntelligencePage } from "@/pages/StoreIntelligencePage";
import { BarChart } from "./charts";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationsView } from "./ConversationsView";
import { RecordFlow } from "./RecordFlow";

const auth = vi.hoisted(() => ({ role: "staff", perms: new Set<string>() }));
const rec = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "me", employee_name: "Asha" }, access: { effectiveRole: auth.role, perms: auth.perms } }) }));
vi.mock("@jewelos/core", async (original) => {
  const actual = await original<typeof import("@jewelos/core")>();
  return { ...actual, hasPermission: (access: { perms: Set<string> } | null, key: string) => Boolean(access?.perms.has(key)) };
});
vi.mock("@/features/recording/useRecorder", () => ({ useRecorder: () => rec.value }));
vi.mock("@jewelos/data", () => {
  class AnalysisActionError extends Error {}
  class WorkspaceError extends Error { kind = "unavailable"; }
  return {
    AnalysisActionError, WorkspaceError,
    fetchToday: vi.fn(), fetchConversationPage: vi.fn(), fetchConversationCard: vi.fn(), fetchAnalysisSnapshot: vi.fn(), fetchActionTasks: vi.fn(async () => []),
    createActionTask: vi.fn(async () => ({ taskId: "t1", alreadyCreated: false })), fetchEvidenceAudio: vi.fn(async () => ({ url: "blob:clip", clipStartMs: 58000 })),
    reviewAnalysis: vi.fn(), requestRescore: vi.fn(async () => ({ alreadyRequested: false })), requestReprocess: vi.fn(), correctTranscript: vi.fn(),
    recordingSnapshot: vi.fn(async () => ({ session: {}, segments: [], alerts: [] })), recordingWalkins: vi.fn(async () => []), linkRecordingWalkin: vi.fn(),
    fetchWorkspaceSettings: vi.fn(async () => ({ config: { employees: [] } })), fetchInsights: vi.fn(), fetchCoachingLists: vi.fn(), fetchDevices: vi.fn(),
  };
});

const recorder = (patch: Record<string, unknown> = {}) => ({
  state: "idle", elapsedMs: 0, level: 0, queuedBytes: 0, network: "connected", captureError: null, activeId: null, isNative: false, inAppWithoutNative: false,
  supported: true, canControl: true, busy: false, error: null, linkNotice: null, start: vi.fn(async () => "s1"), control: vi.fn(), retry: vi.fn(), ...patch,
});
const today = (patch: Record<string, unknown> = {}) => ({
  pilot_enabled: true, has_capture_permission: true, can_record: true, analysis_enabled: true, retention_days: 7, consent_version: "pilot-v1", is_reviewer: false,
  today: { total: 0, recording: 0, saving: 0, processing: 0, ready: 0, needs_attention: 0, recorded_ms: 0 }, recent: [],
  coaching: { reviewed: 0, average_score: null, strength: null, focus: null, tip: null }, next_actions: [], review_queue: null, ...patch,
});
const card = (patch: Partial<ConversationCard> = {}): ConversationCard => ({
  id: "sess", employee_id: "me", employee_name: "Asha", branch_name: "Store", created_at: "2026-11-05T06:00:00Z", capture_ended_at: null, status: "ready", stage: "ready",
  error_reason: null, expires_at: "2099-01-01T00:00:00Z", retention_expired: false, duration_ms: 240_000, customer_linked: false, transcript_ready: true, awaiting_review: false,
  analysis: { id: "a1", status: "scored", review_state: null, score: 76, manager_scored: false, outcome: "follow_up", summary: "Bridal enquiry.", action_count: 1, status_reasons: [] },
  is_reviewer: true, is_own: false, ...patch,
});
const seg = (id: string, start: number, speaker: "employee" | "customer" | "unknown", raw: string) => ({
  segment_id: id, ordinal: start, source_sequence: 0, source_offset_ms: 0, start_ms: start * 1000, end_ms: start * 1000 + 900, speaker, speaker_confidence: null,
  speaker_source: "diarization" as const, language: "hi", raw_text: raw, display_text: null, translation_en: null, stt_confidence: 0.9,
});
const no = { detected: false, confidence: 0.8, reason: "Not observed.", evidence: [] };
const analysis: StoredSalesAnalysis = {
  id: "a1", transcript_revision_id: "r1", rubric_version_id: "rb", rubric_version: 1, sop_version_id: null, sop_version: null, job_version: "mk-sales-v1",
  analyzer_provider: "p", analyzer_model: "model-1", prompt_version: "mk-sales-prompt-v1", fallback_used: false, fallback_reason: null,
  status: "scored", status_reasons: [], raw_total: 76, assessed_weight: 75, supersedes_id: null, created_at: "2026-11-05T10:00:00Z", review_state: null, reviews: [],
  quality: { words: 60, spoken_segments: 6, mean_stt_confidence: 0.9, unknown_speaker_share: 0.1 },
  dimensions: [{ dimension_key: "greeting_sop", label: "Greeting & SOP", configured_weight: 15, effective_weight: 20, points: 16, status: "assessed", rating: 8, reason: "Warm welcome.", evidence: [{ segment_id: "s1", quote: "aapka swagat hai" }] }],
  output: {
    summary: "Bridal enquiry.", key_points: [{ text: "Bridal necklace", evidence: [{ segment_id: "s2", quote: "bridal necklace" }] }],
    product_interests: [], customer_requirements: { budget: null, occasion: null, requirements: [] }, customer_concerns: [], competitor_mentions: [], purchase_blockers: [],
    coaching_strengths: [], coaching_gaps: [], coaching_interventions: [{ text: "Tell the value story", reason: "Price reaction", evidence: [] }],
    next_best_actions: [{ action: "Call back with designs", reason: "Asked for options", evidence: [] }], policy_findings: [], analyzer_confidence: 0.8,
    signals: { objection: no, price_concern: no, stock_gap: no, competitor_mention: no, customer_questions: no, conversion_signal: no, next_step: no, drop_off: no, upsell_opportunity: no,
      sales_outcome: { value: "follow_up", confidence: 0.8, reason: "Visit.", evidence: [{ segment_id: "s2", quote: "bridal necklace" }] } },
  },
};
const snapshot = (over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot => ({
  session_id: "sess", is_reviewer: true, revision_id: "r1",
  revisions: [{ id: "r1", revision: 1, source: "machine", base_revision_id: null, stt_provider: "gpu", stt_model: "m", diarization_provider: null, created_by: null, reason: null, created_at: "2026-11-05T10:00:00Z" }],
  segments: [seg("s1", 1, "employee", "Namaste ji, aapka swagat hai"), seg("s2", 61, "unknown", "bridal necklace chahiye")],
  analyses: [analysis], jobs: [], ...over,
});
const navigate = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined); HTMLMediaElement.prototype.pause = vi.fn();
  auth.role = "staff"; auth.perms = new Set(["recording.capture"]);
  rec.value = recorder();
  vi.mocked(fetchToday).mockResolvedValue(today());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Store Intelligence navigation", () => {
  it("shows a salesperson only Today and Conversations", async () => {
    render(<StoreIntelligencePage navigate={navigate} path="/sales-recording" search="" />);
    const nav = screen.getByRole("navigation", { name: "Store Intelligence" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Today", "Conversations"]);
    expect(within(nav).getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("button", { name: "Start conversation" })).toBeTruthy();
  });
  it("gives managers every tab, and keeps a salesperson out of manager views opened by URL", async () => {
    auth.role = "manager"; auth.perms = new Set(["recording.review"]);
    const { unmount } = render(<StoreIntelligencePage navigate={navigate} path="/sales-recording" search="" />);
    expect(within(screen.getByRole("navigation", { name: "Store Intelligence" })).getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Today", "Conversations", "Coaching", "Insights", "Devices", "Settings"]);
    unmount();
    auth.role = "staff"; auth.perms = new Set();
    render(<StoreIntelligencePage navigate={navigate} path="/sales-recording/insights" search="" />);
    expect(screen.getByText(/That view is for managers/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start conversation" })).toBeNull();
  });
  it("moves between tabs with arrow keys", () => {
    auth.role = "manager"; auth.perms = new Set(["recording.review"]);
    render(<StoreIntelligencePage navigate={navigate} path="/sales-recording" search="" />);
    const links = within(screen.getByRole("navigation", { name: "Store Intelligence" })).getAllByRole("link");
    links[0]!.focus(); fireEvent.keyDown(links[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(links[1]);
  });
});

describe("Recording flow", () => {
  it("needs consent before Start, and explains blocked microphones and offline", async () => {
    render(<RecordFlow navigate={navigate} />);
    const start = screen.getByRole("button", { name: /Start recording/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByText("Asha")).toBeTruthy();
    expect(screen.getByText(/cannot be changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    expect(rec.value.start).toHaveBeenCalledWith(undefined);
  });
  it("refuses unsupported browsers without touching the microphone", () => {
    rec.value = recorder({ supported: false });
    render(<RecordFlow navigate={navigate} />);
    expect(screen.getByText(/cannot safely record here/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: /Start recording/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("never shows Saved while audio is still uploading", () => {
    rec.value = recorder({ state: "saving", activeId: "s1", queuedBytes: 3 * 1024 * 1024, elapsedMs: 65_000 });
    render(<RecordFlow navigate={navigate} />);
    expect(screen.getByText("Saving…")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Saved" })).toBeNull();
    expect(screen.getByText(/3.0 MB waiting to upload/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry upload" })).toBeTruthy();
  });
  it("shows Saved only once the server has the recording", () => {
    rec.value = recorder({ state: "processing", activeId: "s1", elapsedMs: 65_000 });
    render(<RecordFlow navigate={navigate} />);
    expect(screen.getByRole("heading", { name: "Saved" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
    expect(navigate).toHaveBeenCalledWith("/sales-recording/conversations/s1");
  });
  it("offers Pause and Finish while recording and reports offline honestly", () => {
    rec.value = recorder({ state: "recording", activeId: "s1", network: "offline", elapsedMs: 12_000 });
    render(<RecordFlow navigate={navigate} />);
    expect(screen.getByRole("button", { name: /Pause/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
    expect(rec.value.control).toHaveBeenCalledWith("stop");
    expect(screen.getByText(/uploads when you are back online/)).toBeTruthy();
  });
});

describe("Conversation detail", () => {
  beforeEach(() => { vi.mocked(fetchConversationCard).mockResolvedValue(card()); vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot()); });

  it("shows the score and outcome, and plays from a quoted moment for managers", async () => {
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="summary" />);
    expect(await screen.findByText("Bridal enquiry.", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("76")).toBeTruthy();
    expect(screen.getAllByText(/Follow-up agreed/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: /1:01 · “bridal necklace”/ })[0]!);
    await waitFor(() => expect(fetchEvidenceAudio).toHaveBeenCalledWith("sess", 59500, 119500));
    expect(screen.getByRole("region", { name: "Conversation audio" })).toBeTruthy();
  });
  it("hides audio and review tools from the salesperson", async () => {
    vi.mocked(fetchConversationCard).mockResolvedValue(card({ is_reviewer: false, is_own: true, analysis: null, awaiting_review: true }));
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot({ is_reviewer: false, analyses: [] }));
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="coaching" />);
    expect(await screen.findAllByText(/manager reviews the summary and coaching/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Conversation audio" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
  it("needs a reason to flag, approves, and requests a rescore", async () => {
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="coaching" />);
    fireEvent.click(await screen.findByRole("button", { name: "Flag" }));
    expect(await screen.findByText("Add a short reason first.")).toBeTruthy();
    expect(reviewAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reviewAnalysis).toHaveBeenCalledWith("a1", "approve", null));
    fireEvent.change(screen.getByLabelText(/Reason or note/), { target: { value: "Speaker fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Request rescore" }));
    await waitFor(() => expect(requestRescore).toHaveBeenCalledWith("sess", "Speaker fixed"));
  });
  it("expands and collapses every scored area at once", async () => {
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="coaching" />);
    const toggle = await screen.findByRole("button", { name: /Greeting & SOP/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
  it("searches the transcript and saves only changed lines as a correction", async () => {
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="transcript" />);
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search transcript" }), { target: { value: "necklace" } });
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(screen.getByText("Salesperson")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Correct transcript" }));
    fireEvent.change(screen.getAllByRole("combobox", { name: "Speaker" })[1]!, { target: { value: "customer" } });
    fireEvent.change(screen.getByLabelText(/Reason \(needed/), { target: { value: "Customer voice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(correctTranscript).toHaveBeenCalledWith("sess", "r1", [{ segment_id: "s2", speaker: "customer" }], "Customer voice"));
  });
  it("creates one follow-up task and then shows its status instead of the button", async () => {
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="actions" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create follow-up task" }));
    fireEvent.click(screen.getByRole("button", { name: /Tomorrow, 11 AM/ }));
    await waitFor(() => expect(createActionTask).toHaveBeenCalledWith("a1", 0, expect.stringMatching(/T05:30:00.000Z$/)));
    vi.mocked(fetchActionTasks).mockResolvedValue([{ analysis_id: "a1", action_index: 0, task_id: "t1", created_at: "x", task_status: "pending", planned_datetime: null, deleted: false }]);
    cleanup();
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="actions" />);
    expect(await screen.findByText("Task open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create follow-up task" })).toBeNull();
  });
  it("explains a missing score instead of guessing, and notes retention expiry", async () => {
    vi.mocked(fetchConversationCard).mockResolvedValue(card({ retention_expired: true }));
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot({ analyses: [{ ...analysis, status: "insufficient_evidence", raw_total: null, status_reasons: ["too_little_speech"], dimensions: [], output: {} }] }));
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="coaching" />);
    expect(await screen.findByText("No score", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Too little speech to judge")).toBeTruthy();
    expect(screen.getByText(/removed after the retention period/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Conversation audio" })).toBeNull();
  });
});

describe("Conversations list", () => {
  it("sends URL filters to the server and pages with a cursor", async () => {
    vi.mocked(fetchConversationPage).mockResolvedValueOnce({ rows: [card({ id: "a" })], has_more: true, is_reviewer: false })
      .mockResolvedValueOnce({ rows: [card({ id: "b", created_at: "2026-11-04T06:00:00Z" })], has_more: false, is_reviewer: false });
    render(<ConversationsView isReviewer={false} navigate={navigate} search="?stage=ready&q=ring" />);
    await waitFor(() => expect(fetchConversationPage).toHaveBeenCalledWith({ q: "ring", stage: "ready" }));
    expect(screen.getByRole("button", { name: "Remove filter: Ready" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(fetchConversationPage).toHaveBeenLastCalledWith({ q: "ring", stage: "ready" }, { before: "2026-11-05T06:00:00Z", beforeId: "a" }));
    expect(await screen.findByText(/That is everything that matches/)).toBeTruthy();
  });
  it("tells people when nothing matches and offers to clear filters", async () => {
    vi.mocked(fetchConversationPage).mockResolvedValue({ rows: [], has_more: false, is_reviewer: false });
    render(<ConversationsView isReviewer={false} navigate={navigate} search="?outcome=no_purchase" />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(navigate).toHaveBeenCalledWith("/sales-recording/conversations");
  });
  it("opens filters in a focus-managed drawer that closes with Escape", async () => {
    vi.mocked(fetchConversationPage).mockResolvedValue({ rows: [], has_more: false, is_reviewer: false });
    render(<ConversationsView isReviewer={false} navigate={navigate} search="" />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Charts", () => {
  it("offers the exact numbers as a table", () => {
    render(<BarChart points={[{ key: "a", label: "1 Nov", value: 3 }, { key: "b", label: "2 Nov", value: 5 }]} title="Conversations per day" valueLabel="Conversations" />);
    expect(screen.getByText(/Highest: 2 Nov, 5/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "2 Nov" })).toBeTruthy();
  });
});
