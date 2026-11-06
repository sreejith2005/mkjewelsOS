// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConversationIntegration, type AnalysisSnapshot, type ConversationCard, type StoredSalesAnalysis } from "@jewelos/core";
import {
  correctTranscript, createFollowUp, fetchAnalysisSnapshot, fetchConversationCard, fetchConversationIntegration, fetchConversationPage, fetchEvidenceAudio,
  fetchToday, linkCrmCustomer, requestRescore, reviewAnalysis,
} from "@jewelos/data";
import { searchCrmCandidates } from "./crmCandidateSearch";
import { StoreIntelligencePage } from "@/pages/StoreIntelligencePage";
import { BarChart } from "./charts";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationsView } from "./ConversationsView";
import { RecordFlow } from "./RecordFlow";
import { TodayView } from "./TodayView";

const auth = vi.hoisted(() => ({ role: "staff", perms: new Set<string>() }));
const rec = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "me", employee_name: "Asha" }, access: { effectiveRole: auth.role, perms: auth.perms } }) }));
vi.mock("@jewelos/core", async (original) => {
  const actual = await original<typeof import("@jewelos/core")>();
  return { ...actual, hasPermission: (access: { perms: Set<string> } | null, key: string) => Boolean(access?.perms.has(key)) };
});
vi.mock("@/features/recording/useRecorder", () => ({ useRecorder: () => rec.value }));
vi.mock("./crmCandidateSearch", () => ({ CandidateSearchFailure: class extends Error {}, searchCrmCandidates: vi.fn() }));
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
    fetchConversationIntegration: vi.fn(), linkCrmCustomer: vi.fn(async () => ({ linkId: "l1", alreadyLinked: false })), unlinkCrmCustomer: vi.fn(), retryCrmSync: vi.fn(),
    createFollowUp: vi.fn(async () => ({ followUpId: "f1", taskId: "t1", fmsInstanceId: null, fmsReference: null, alreadyCreated: false })),
    fetchFollowUpOptions: vi.fn(async () => ({ owners: [{ id: "me", name: "Asha", is_salesperson: true }], supervisors: [], flows: [], default_due: null })),
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
const integration = (patch: Record<string, unknown> = {}) => parseConversationIntegration({
  can_link: true, can_create_follow_up: true, is_reviewer: true, customer: null, history: [],
  outcome: { ai_label: "converted", crm: { state: "pending_crm_confirmation", reason: "not_linked" } }, follow_ups: [],
  suggestions: [{ analysis_id: "a1", action_index: 0, action: "Call back with designs", reason: "Asked for options", existing: null }],
  readiness: { client_match: "not_linked", crm_sync: "not_linked", crm_outcome: "pending_crm_confirmation", work: "none", notifications: "none" }, outcome_window_days: 30, ...patch,
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined); HTMLMediaElement.prototype.pause = vi.fn();
  auth.role = "staff"; auth.perms = new Set(["recording.capture"]);
  rec.value = recorder();
  vi.mocked(fetchToday).mockResolvedValue(today());
  vi.mocked(fetchConversationIntegration).mockResolvedValue(integration());
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
  it("reviews a follow-up before creating it, on a first-half / second-half deadline, and then shows it instead of the button", async () => {
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="actions" />);
    fireEvent.click(await screen.findByRole("button", { name: "Review follow-up" }));
    expect(screen.getAllByText(/Nothing is sent to the customer from here/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Recommended follow-up"), { target: { value: "whatsapp" } });
    fireEvent.change(screen.getByLabelText("Due day"), { target: { value: "2026-11-09" } });
    fireEvent.click(screen.getByRole("radio", { name: /First half \(3 PM\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(createFollowUp).toHaveBeenCalledWith(expect.objectContaining({ analysisId: "a1", actionIndex: 0, channel: "whatsapp", dueDate: "2026-11-09", dueHalf: "first_half", fmsFlowId: null, title: "Follow up: Call back with designs" })));
    const firstKey = vi.mocked(createFollowUp).mock.calls[0]![0].requestKey;
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
    vi.mocked(fetchConversationIntegration).mockResolvedValue(integration({
      suggestions: [{ analysis_id: "a1", action_index: 0, action: "Call back with designs", reason: "Asked for options", existing: { task_id: "t1" } }],
      follow_ups: [{ follow_up_id: "f1", title: "Follow up: Call back with designs", created_at: "2026-11-06T06:00:00Z", channel: "whatsapp", status: "pending", task_id: "t1", due_at: "2026-11-09T09:30:00Z", due_half: "first_half", owner_name: "Asha" }],
    }));
    cleanup();
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="actions" />);
    expect(await screen.findByText(/Follow-up created/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review follow-up" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open task" }).getAttribute("href")).toBe("/tasks?task_id=t1");
    expect(screen.getByText(/WhatsApp message · Asha/)).toBeTruthy();
  });
  it("keeps the AI's reading apart from the CRM result and shows readiness for each integration", async () => {
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="summary" />);
    expect(await screen.findByText("Converted (AI-suggested)")).toBeTruthy();
    expect(screen.getByText("Pending CRM confirmation")).toBeTruthy();
    const ready = screen.getByRole("list", { name: "Integration status" });
    expect(within(ready).getAllByRole("listitem").map((item) => item.firstChild?.textContent)).toEqual(["Client match", "CRM activity", "Task / FMS", "Notification"]);
  });
  it("makes a person choose between customers sharing a phone, and links the chosen one as unconfirmed", async () => {
    vi.mocked(searchCrmCandidates).mockResolvedValue({ query_kind: "phone", candidates: [
      { kind: "client", target_id: "c1", client_id: "c1", client_code: "MKC-1", name: "Asha Family", phone_hint: "••1111", last_visit_at: null, total_visits: 2, visit_at: null, visit_reference: null },
      { kind: "client", target_id: "c2", client_id: "c2", client_code: "MKC-2", name: "Ravi Family", phone_hint: "••1111", last_visit_at: null, total_visits: 1, visit_at: null, visit_reference: null },
    ] });
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="summary" />);
    fireEvent.click(await screen.findByRole("button", { name: /Customer details/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Link customer" }));
    const search = screen.getByRole("button", { name: /Search/ }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Client code, visit reference or full phone number/), { target: { value: "Ravi" } });
    expect(search.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Client code, visit reference or full phone number/), { target: { value: "98111 11111" } });
    fireEvent.click(search);
    expect(await screen.findByText(/2 people share this number/)).toBeTruthy();
    const link = screen.getByRole("button", { name: "Link this customer" }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Ravi Family/ }));
    fireEvent.click(link);
    await waitFor(() => expect(linkCrmCustomer).toHaveBeenCalledWith("sess",
      { kind: "client", target_id: "c2", match_basis: "phone", candidate_count: 2, display_code: "MKC-2", display_name: "Ravi Family" }, expect.stringMatching(/^[0-9a-f-]{36}$/), undefined));
    expect(await screen.findByText(/confirmed once the CRM accepts it/)).toBeTruthy();
  });
  it("shows the CRM link truthfully and needs a reason to change it", async () => {
    vi.mocked(fetchConversationIntegration).mockResolvedValue(integration({
      customer: { link_id: "l1", kind: "client", target_id: "c1", crm_client_id: "c1", code: "MKC-1", name: "Asha Family", display_source: "crm_ack", match_basis: "phone", candidate_count: 2,
        state: "verified", linked_at: "2026-11-05T10:00:00Z", sync: "failed", sync_attempts: 10 },
      readiness: { client_match: "verified", crm_sync: "failed", crm_outcome: "no_crm_purchase_yet", work: "none", notifications: "none" },
    }));
    render(<ConversationDetail navigate={navigate} sessionId="sess" tab="summary" />);
    fireEvent.click(await screen.findByRole("button", { name: /Customer details/ }));
    expect(await screen.findByText("Sending to CRM failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send again/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open CRM profile/ }));
    expect(navigate).toHaveBeenCalledWith("/crm/clients/c1");
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

describe("Today", () => {
  it("sends suggested next actions to review instead of creating work with a preset time", async () => {
    vi.mocked(fetchToday).mockResolvedValue(today({ next_actions: [{ session_id: "sess", analysis_id: "a1", action_index: 0, action: "Call back with designs", reason: null, created_at: "2026-11-05T06:00:00Z" }] }));
    render(<TodayView canRecordUi navigate={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review follow-up" }));
    expect(navigate).toHaveBeenCalledWith("/sales-recording/conversations/sess?tab=actions");
    expect(createFollowUp).not.toHaveBeenCalled();
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
