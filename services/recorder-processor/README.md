# Recorder processor (private GPU)

The speech-to-text and speaker service the recorder worker calls through
`RECORDER_GPU_URL` (`services/recorder/adapters.py` `PrivateGPU`). It replaces
the legacy public Flask pipeline. It holds no database or Supabase credential:
it receives two-minute signed S3 URLs from the worker, checks every chunk's size
and SHA-256, and returns text. It never logs audio, text or URLs.

## Contract

`POST /v1/transcribe`, `Authorization: Bearer $PROCESSOR_TOKEN` (the worker's
`RECORDER_GPU_TOKEN`). Body `{job_id, session_id, kind, format, chunks}` where
each chunk is `{sequence, sha256, byte_count, url}`; the URL host must be in
`PROCESSOR_AUDIO_HOSTS`. Provisional jobs carry at most two chunks (the live
chunk plus one context chunk) and are never diarized. Final jobs carry every chunk.

Response: `{provider, model, diarization_provider, segments}`. There is one
segment per requested chunk, including empty text for silence. Each segment holds
`utterances` with `offset_ms`/`end_offset_ms` relative to that chunk's start,
`text` (original language), `language`, `confidence`, optional
`translation_en`, `speaker_role` and `speaker_confidence`. An utterance belongs to
the chunk it starts in. The recorder turns this into the immutable transcript
revision (`services/recorder/transcript.py`); `tests/test_processor.py` checks
that builder directly.

## Speakers

pyannote 3.1 separates the voices, as the legacy pipeline did. The recorder is
worn by or sits next to the employee, so the employee is the voice that is
**clearly louder** than every other. That means at least 6 dB above the next
voice, which earns a confidence of 0.88 or more; the score falls when the
"employee" barely speaks or there are more than two voices. A single voice, a
smaller level gap or a weak overlap stays below 0.85, and the worker then stores
the speaker as **unknown**. Talk time alone, the legacy rule, never decides.
Managers can correct speakers on the review screen. These are pilot settings:
calibrate them with `bench.py` on real store audio (`ROLE_*` constants in
`processor.py`).

## Engines

| `PROCESSOR_ENGINE` | Model | Notes |
| --- | --- | --- |
| `whisper` (default) | faster-whisper, `PROCESSOR_WHISPER_MODEL` (for example `large-v3`) | Word timestamps and probabilities (confidence); VAD; language limited to `PROCESSOR_LANGUAGES` (default `hi,en`; add `mr`, `gu` only after their benchmark); `PROCESSOR_TRANSLATE=true` adds English per stretch (about 2× compute). |
| `indic_conformer` | ai4bharat IndicConformer 600M (legacy) | One fixed `PROCESSOR_LANGUAGE`, no confidence (reviewers see no "unclear audio" hint). Install `requirements-indic.txt`. |

Guards kept from the legacy pipeline:
- A word repeated more than five times in a row caps confidence at 0.3, which sends the analysis to manager review.
- Whisper does not condition on earlier text, which reduces loops.
- Likely hallucinations over silence are dropped.

## Configuration

| Variable | Meaning |
| --- | --- |
| `PROCESSOR_TOKEN` | Dedicated bearer, 24+ characters, same value as the worker's `RECORDER_GPU_TOKEN`. Secret manager only. |
| `PROCESSOR_AUDIO_HOSTS` | Exact S3 hostnames of the private audio bucket (for example `<bucket>.s3.ap-south-1.amazonaws.com`). |
| `PROCESSOR_ENGINE`, `PROCESSOR_WHISPER_MODEL`, `PROCESSOR_LANGUAGES`, `PROCESSOR_TRANSLATE`, `PROCESSOR_COMPUTE_TYPE`, `PROCESSOR_DEVICE` | Engine choice, see above. |
| `PROCESSOR_DIARIZATION` | Exactly `true` to load pyannote (final jobs only). |
| `PROCESSOR_HF_TOKEN` | Hugging Face read token for pyannote's gated model (accept its terms first). Secret manager only. |

## Deploy

1. Build the `Dockerfile` (CUDA 12.4 + cuDNN 9). Run it on a GPU instance in the
   **private** subnet, reachable only from the worker's security group, behind a
   private TLS load balancer whose DNS name goes in the worker's
   `RECORDER_GPU_HOSTS`. Mount a private volume at `/models` for weights.
2. Measure before activating capture. Run
   `python bench.py --audio <dir> --refs <refs.json> --out <report.json>` on
   owner-supplied store recordings (kept outside Git) and keep the report. Check:
   - word error rate per language
   - real-time factor: a final job must finish inside the worker's 100 s
     deadline, so long conversations need a real-time factor under about
     `80 / audio seconds`
   - live lag p95
   - unknown-speaker share
3. Point the worker at it (`RECORDER_GPU_URL=https://<private-host>/v1/transcribe`).

One request uses the GPU at a time per process; scale with processes or GPUs.
The service has a server-side deadline of 80 s, below the adapter's 85 s.

## Tests

```powershell
python -m pytest -q   # from services/recorder-processor, same venv as services/recorder
```

The tests use fake engines and do **not** prove model accuracy, GPU speed or
pyannote behaviour. `bench.py` produces that evidence.
