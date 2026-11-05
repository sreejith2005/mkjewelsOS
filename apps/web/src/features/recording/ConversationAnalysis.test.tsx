// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisSnapshot, StoredSalesAnalysis } from "@jewelos/core";
import { correctTranscript, fetchAnalysisSnapshot, fetchEvidenceAudio, requestRescore, reviewAnalysis } from "@jewelos/data";
import { ConversationAnalysis } from "./ConversationAnalysis";

vi.mock("@jewelos/data", () => {
  class AnalysisActionError extends Error {}
  return { AnalysisActionError, fetchAnalysisSnapshot: vi.fn(), correctTranscript: vi.fn(), requestRescore: vi.fn(async () => ({ alreadyRequested: false })), requestReprocess: vi.fn(), reviewAnalysis: vi.fn(), fetchEvidenceAudio: vi.fn(async () => ({ url: "blob:clip", clipStartMs: 58000 })) };
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
    coaching_strengths: [], coaching_gaps: [], coaching_interventions: [{ text: "Tell the value story", reason: "Price reaction", evidence: [{ segment_id: "s2", quote: "bridal necklace" }] }],
    next_best_actions: [], policy_findings: [], analyzer_confidence: 0.8,
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

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Conversation review", () => {
  it("shows the server score with weights and jumps from evidence to the quoted line", async () => {
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot());
    render(<ConversationAnalysis sessionId="sess" />);
    expect(await screen.findByText("76.0")).toBeTruthy();
    expect(screen.getByText(/weight 15% → 20.0%/)).toBeTruthy();
    expect(screen.getByText(/AI recommendation, not a verified result/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /1:01 · “bridal necklace”/ })[0]!);
    await waitFor(() => expect(document.getElementById("analysis-seg-s2")?.className).toContain("border-gold"));
    expect(screen.getAllByText(/Unknown speaker/).length).toBeGreaterThan(0);
    // Managers also hear the moment: a short window around the quoted line.
    await waitFor(() => expect(fetchEvidenceAudio).toHaveBeenCalledWith("sess", 59500, 63500));
    expect(await screen.findByText(/Playing 1:01/)).toBeTruthy();
  });

  it("plays a transcript line on request and explains a refused listen", async () => {
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot());
    render(<ConversationAnalysis sessionId="sess" />);
    fireEvent.click(await screen.findByRole("button", { name: "Play 0:01" }));
    await waitFor(() => expect(fetchEvidenceAudio).toHaveBeenCalledWith("sess", 0, 4000));
    expect(await screen.findByRole("region", { name: "Evidence audio" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip"));
    const { AnalysisActionError } = await import("@jewelos/data");
    vi.mocked(fetchEvidenceAudio).mockRejectedValueOnce(new AnalysisActionError("Audio for this moment is unavailable."));
    fireEvent.click(screen.getByRole("button", { name: "Play 1:01" }));
    expect(await screen.findByText("Audio for this moment is unavailable.")).toBeTruthy();
  });

  it("tells employees their manager reviews first", async () => {
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot({ is_reviewer: false, analyses: [] }));
    render(<ConversationAnalysis sessionId="sess" />);
    expect(await screen.findByText(/Your manager reviews the AI analysis/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Correct transcript" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });

  it("needs a reason to flag, approves, and requests a rescore", async () => {
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot());
    render(<ConversationAnalysis sessionId="sess" />);
    fireEvent.click(await screen.findByRole("button", { name: "Flag" }));
    expect(await screen.findByText("Add a short reason first.")).toBeTruthy();
    expect(reviewAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reviewAnalysis).toHaveBeenCalledWith("a1", "approve", null));
    fireEvent.change(screen.getByLabelText(/Reason or note/), { target: { value: "Speaker fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Request rescore" }));
    await waitFor(() => expect(requestRescore).toHaveBeenCalledWith("sess", "Speaker fixed"));
  });

  it("saves a transcript correction as a new version with only the changed lines", async () => {
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot());
    render(<ConversationAnalysis sessionId="sess" />);
    fireEvent.click(await screen.findByRole("button", { name: "Correct transcript" }));
    fireEvent.change(screen.getAllByRole("combobox", { name: "Speaker" })[1]!, { target: { value: "customer" } });
    fireEvent.change(screen.getByLabelText(/Reason or note/), { target: { value: "Customer voice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(correctTranscript).toHaveBeenCalledWith("sess", "r1", [{ segment_id: "s2", speaker: "customer" }], "Customer voice"));
  });

  it("explains a missing score instead of guessing", async () => {
    vi.mocked(fetchAnalysisSnapshot).mockResolvedValue(snapshot({ analyses: [{ ...analysis, status: "insufficient_evidence", raw_total: null, status_reasons: ["too_little_speech"], dimensions: [], output: {} }] }));
    render(<ConversationAnalysis sessionId="sess" />);
    expect(await screen.findByText("No score")).toBeTruthy();
    expect(screen.getByText("Too little speech to judge")).toBeTruthy();
  });
});
