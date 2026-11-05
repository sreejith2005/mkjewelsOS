"""Machine-readable contracts for Store Intelligence processing.

These pydantic models validate untrusted model and processor output in the
worker. The database validates again (migration 0379). Exported JSON Schemas
live in contracts/*.schema.json; `python contracts.py` regenerates them and
tests/test_contracts.py fails if they drift.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator

Confidence = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Text400 = Annotated[str, Field(min_length=1, max_length=400)]
Reason = Annotated[str, Field(min_length=1, max_length=300)]


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class EvidenceRef(Strict):
    segment_id: UUID
    quote: Annotated[str, Field(min_length=3, max_length=500, description='Verbatim words from that segment.')]


Evidence = Annotated[list[EvidenceRef], Field(max_length=5)]
RequiredEvidence = Annotated[list[EvidenceRef], Field(min_length=1, max_length=5)]


class Claim(Strict):
    text: Text400
    evidence: RequiredEvidence


class Intervention(Strict):
    text: Text400
    reason: Text400
    evidence: RequiredEvidence


class NextAction(Strict):
    action: Annotated[str, Field(min_length=1, max_length=300)]
    reason: Text400
    evidence: RequiredEvidence


class Signal(Strict):
    detected: StrictBool
    confidence: Confidence
    reason: Reason
    evidence: Evidence

    @model_validator(mode='after')
    def detected_needs_evidence(self) -> 'Signal':
        if self.detected and not self.evidence:
            raise ValueError('a detected signal needs evidence')
        return self


class SalesOutcome(Strict):
    value: Literal['unknown', 'enquiry', 'follow_up', 'reported_purchase', 'no_purchase']
    confidence: Confidence
    reason: Reason
    evidence: Evidence

    @model_validator(mode='after')
    def known_outcome_needs_evidence(self) -> 'SalesOutcome':
        if self.value != 'unknown' and not self.evidence:
            raise ValueError('a sales outcome needs evidence')
        return self


class Signals(Strict):
    objection: Signal
    price_concern: Signal
    stock_gap: Signal
    competitor_mention: Signal
    customer_questions: Signal
    conversion_signal: Signal
    next_step: Signal
    drop_off: Signal
    upsell_opportunity: Signal
    sales_outcome: SalesOutcome


class Requirements(Strict):
    budget: Claim | None
    occasion: Claim | None
    requirements: Annotated[list[Claim], Field(max_length=10)]


class PolicyFinding(Strict):
    severity: Literal['low', 'medium', 'high']
    clause_id: Annotated[str, Field(pattern=r'^[A-Z0-9][A-Z0-9._-]{0,39}$')]
    statement: Text400
    evidence: RequiredEvidence


class AnalysisOutput(Strict):
    """No field exists for age, gender, emotion, religion, caste or other sensitive attributes."""
    summary: Annotated[str, Field(min_length=1, max_length=600)]
    key_points: Annotated[list[Claim], Field(min_length=3, max_length=5)]
    product_interests: Annotated[list[Claim], Field(max_length=10)]
    customer_requirements: Requirements
    customer_concerns: Annotated[list[Claim], Field(max_length=10)]
    competitor_mentions: Annotated[list[Claim], Field(max_length=10)]
    purchase_blockers: Annotated[list[Claim], Field(max_length=10)]
    coaching_strengths: Annotated[list[Claim], Field(max_length=5)]
    coaching_gaps: Annotated[list[Claim], Field(max_length=5)]
    coaching_interventions: Annotated[list[Intervention], Field(min_length=1, max_length=3)]
    next_best_actions: Annotated[list[NextAction], Field(max_length=5)]
    signals: Signals
    policy_findings: Annotated[list[PolicyFinding], Field(max_length=10)]
    analyzer_confidence: Confidence


class DimensionResult(Strict):
    key: Annotated[str, Field(pattern=r'^[a-z][a-z0-9_]{1,39}$')]
    status: Literal['assessed', 'not_applicable', 'insufficient_evidence']
    rating: Annotated[StrictInt, Field(ge=0, le=10)] | None
    reason: Annotated[str, Field(min_length=1, max_length=600)]
    evidence: Evidence

    @model_validator(mode='after')
    def rating_only_when_assessed(self) -> 'DimensionResult':
        if (self.status == 'assessed') != (self.rating is not None):
            raise ValueError('rating is required for assessed dimensions and forbidden otherwise')
        if self.status == 'assessed' and not self.evidence:
            raise ValueError('an assessed dimension needs evidence')
        return self


class ModelResponse(Strict):
    """What the analysis model must return."""
    status_hint: Literal['scored', 'insufficient_evidence']
    output: AnalysisOutput | None
    dimensions: list[DimensionResult]

    @model_validator(mode='after')
    def scored_needs_everything(self) -> 'ModelResponse':
        if self.status_hint == 'scored' and (self.output is None or not self.dimensions):
            raise ValueError('a scored response needs output and dimensions')
        return self


class AnalyzerInfo(Strict):
    provider: Annotated[str, Field(min_length=1, max_length=80)]
    model: Annotated[str, Field(min_length=1, max_length=120)]
    prompt_version: Annotated[str, Field(pattern=r'^[a-z0-9][a-z0-9._-]{0,39}$')]
    fallback_used: StrictBool
    fallback_reason: Annotated[str, Field(pattern=r'^[a-z_]{1,64}$')] | None


class AnalysisSubmission(Strict):
    """`result` of the analysis_submit boundary action."""
    status_hint: Literal['scored', 'insufficient_evidence']
    analyzer: AnalyzerInfo
    output: AnalysisOutput | Annotated[dict[str, None], Field(max_length=0, description='Empty when insufficient.')]
    dimensions: list[DimensionResult]


class FinalizeSegment(Strict):
    segment_id: UUID
    source_sequence: Annotated[StrictInt, Field(ge=0, le=7200)]
    source_offset_ms: Annotated[StrictInt, Field(ge=0, le=120000)]
    start_ms: Annotated[StrictInt, Field(ge=0, le=14400000)]
    end_ms: Annotated[StrictInt, Field(ge=0, le=14400000)]
    speaker: Literal['employee', 'customer', 'unknown']
    speaker_confidence: Confidence | None
    speaker_source: Literal['diarization', 'manual', 'none']
    language: Annotated[str, Field(pattern=r'^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$')] | None
    raw_text: Annotated[str, Field(max_length=16000)]
    display_text: Annotated[str, Field(max_length=16000)] | None
    translation_en: Annotated[str, Field(max_length=16000)] | None
    stt_confidence: Confidence | None


class TranscriptFinalize(Strict):
    """Payload of transcript_finalize besides the session claims and job lease."""
    stt_provider: Annotated[str, Field(max_length=80)] | None
    stt_model: Annotated[str, Field(max_length=120)] | None
    diarization_provider: Annotated[str, Field(max_length=120)] | None
    segments: Annotated[list[FinalizeSegment], Field(max_length=20000)]


class Utterance(Strict):
    offset_ms: Annotated[StrictInt, Field(ge=0, le=120000, description='From the start of the chunk where the utterance starts.')]
    end_offset_ms: Annotated[StrictInt, Field(ge=0, le=120000)]
    text: Annotated[str, Field(max_length=16000, description='Original language and script, as spoken.')]
    display_text: Annotated[str, Field(max_length=16000, description='Readable Roman-script Hinglish or English. No academic transliteration.')] | None = None
    translation_en: Annotated[str, Field(max_length=16000)] | None = None
    language: str | None = None
    confidence: Confidence | None = None
    speaker_role: Literal['employee', 'customer', 'unknown'] | None = None
    speaker_confidence: Confidence | None = None
    includes_context: StrictBool | None = Field(default=None, description='True when text may repeat the previous chunk tail (context audio).')


class ProcessorSegment(BaseModel):
    """One per canonical chunk. Extra keys (critical_signal) are allowed for the alert path."""
    model_config = ConfigDict(extra='allow', strict=True)
    sequence: Annotated[StrictInt, Field(ge=0, le=7199)]
    text: Annotated[str, Field(max_length=12000)]
    started_ms: Annotated[StrictInt, Field(ge=0, le=14400000)]
    ended_ms: Annotated[StrictInt, Field(ge=0, le=14400000)]
    utterances: Annotated[list[Utterance], Field(max_length=50)] | None = None


class ProcessorResponse(BaseModel):
    """Private STT/diarization processor response for a recorder job."""
    model_config = ConfigDict(extra='forbid', strict=True)
    segments: list[ProcessorSegment]
    provider: Annotated[str, Field(max_length=80)] | None = None
    model: Annotated[str, Field(max_length=120)] | None = None
    diarization_provider: Annotated[str, Field(max_length=120)] | None = None


SCHEMAS = {
    'analysis_model_response': ModelResponse,
    'analysis_submission': AnalysisSubmission,
    'transcript_finalize': TranscriptFinalize,
    'processor_response': ProcessorResponse,
}
SCHEMA_DIR = Path(__file__).resolve().parent / 'contracts'


def schema_text(name: str) -> str:
    return json.dumps(SCHEMAS[name].model_json_schema(mode='validation'), indent=2, sort_keys=True) + '\n'


if __name__ == '__main__':
    for schema_name in SCHEMAS:
        (SCHEMA_DIR / f'{schema_name}.schema.json').write_text(schema_text(schema_name), encoding='utf-8', newline='\n')
