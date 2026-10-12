import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOT_HEARD_MESSAGE,
  VoiceTranscriptionError,
  assertTranscriptWasSpoken,
  assertVoiceUpload,
  transcribeVoice,
  transcriptionModel,
  type TranscribeVoiceOptions,
  type VoiceAudioUpload,
} from "./transcribe.ts";

const upload = (overrides: Partial<VoiceAudioUpload> = {}): VoiceAudioUpload => ({
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "audio/wav",
  filename: "voice-note.wav",
  ...overrides,
});

type Sent = { url: string; form: FormData; authorization: string | null };

/** A fake provider that records what was sent and answers with `payload`. */
function provider(payload: unknown, status = 200): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), form: init?.body as FormData, authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fake, sent };
}

const options = (overrides: Partial<TranscribeVoiceOptions> = {}): TranscribeVoiceOptions => ({
  apiKey: "test-key",
  model: "whisper-1",
  language: "en",
  unavailableMessage: "Transcription is unavailable",
  logEvent: "test_transcribed",
  log: () => {},
  ...overrides,
});

const heard = { text: "Aaj mera kya pending hai", duration: 3.2, language: "hindi", segments: [{ no_speech_prob: 0.01, avg_logprob: -0.2 }] };

Deno.test("assertVoiceUpload accepts a small clip and refuses other types, empty and oversized clips", () => {
  assertVoiceUpload(upload());
  assertVoiceUpload(upload({ contentType: "audio/webm;codecs=opus" }));
  assertEquals(assertThrows(() => assertVoiceUpload(upload({ contentType: "application/pdf" })), VoiceTranscriptionError).status, 415);
  assertEquals(assertThrows(() => assertVoiceUpload(upload({ bytes: new Uint8Array() })), VoiceTranscriptionError).status, 400);
  const tooBig = assertThrows(() => assertVoiceUpload(upload({ bytes: new Uint8Array(VOICE_NOTE_MAX_BYTES + 1) })), VoiceTranscriptionError);
  assertEquals([tooBig.status, tooBig.message], [413, "Keep the recording under 60 seconds"]);
});

Deno.test("transcribeVoice sends the given language to the provider", async () => {
  const fake = provider(heard);
  await transcribeVoice(upload(), options({ fetch: fake.fetch, language: "en" }));
  assertEquals(fake.sent[0]?.form.get("language"), "en");
  assertEquals(fake.sent[0]?.form.get("model"), "whisper-1");
  assertEquals(fake.sent[0]?.form.get("response_format"), "verbose_json");
  assertEquals(fake.sent[0]?.form.get("temperature"), "0");
  assertEquals(fake.sent[0]?.authorization, "Bearer test-key");
  assertEquals(fake.sent[0]?.url, "https://api.openai.com/v1/audio/transcriptions");
});

Deno.test("transcribeVoice lets the provider detect the language when it is null or auto", async () => {
  for (const language of [null, "auto", "  "]) {
    const fake = provider(heard);
    const result = await transcribeVoice(upload(), options({ fetch: fake.fetch, language }));
    assertEquals(fake.sent[0]?.form.has("language"), false);
    assertEquals(result.language, "hindi");
  }
});

Deno.test("transcribeVoice sends a vocabulary prompt only when one is given", async () => {
  const withPrompt = provider(heard);
  await transcribeVoice(upload(), options({ fetch: withPrompt.fetch, prompt: "Kiara, JewelOS." }));
  assertEquals(withPrompt.sent[0]?.form.get("prompt"), "Kiara, JewelOS.");
  const without = provider(heard);
  await transcribeVoice(upload(), options({ fetch: without.fetch, prompt: "" }));
  assertEquals(without.sent[0]?.form.has("prompt"), false);
});

Deno.test("transcribeVoice reports text, duration and whisper's no-speech verdict", async () => {
  const spoken = await transcribeVoice(upload(), options({ fetch: provider(heard).fetch }));
  assertEquals(spoken, { text: "Aaj mera kya pending hai", durationSeconds: 3.2, noSpeech: false, language: "hindi" });
  const silent = await transcribeVoice(upload(), options({ fetch: provider({ text: "Thank you.", duration: 4, segments: [{ no_speech_prob: 0.9, avg_logprob: -0.3 }] }).fetch }));
  assertEquals(silent.noSpeech, true);
  const guessing = await transcribeVoice(upload(), options({ fetch: provider({ text: "Hello", duration: 4, segments: [{ no_speech_prob: 0.1, avg_logprob: -1.5 }] }).fetch }));
  assertEquals(guessing.noSpeech, true);
});

Deno.test("transcribeVoice leaves the verdict unknown for a model without segment analysis", async () => {
  const fake = provider({ text: "hello" });
  const result = await transcribeVoice(upload(), options({ fetch: fake.fetch, model: "gpt-4o-transcribe" }));
  assertEquals(fake.sent[0]?.form.get("response_format"), "json");
  assertEquals(result, { text: "hello", durationSeconds: null, noSpeech: null, language: null });
});

Deno.test("transcribeVoice turns a provider failure into the caller's 502 message", async () => {
  const error = await assertRejects(() => transcribeVoice(upload(), options({ fetch: provider({ error: "echo of the request" }, 500).fetch })), VoiceTranscriptionError);
  assertEquals([error.status, error.message], [502, "Transcription is unavailable"]);
});

Deno.test("transcribeVoice logs the shape of the clip, never the words", async () => {
  const lines: string[] = [];
  await transcribeVoice(upload(), options({ fetch: provider(heard).fetch, log: (line) => lines.push(line) }));
  assertEquals(JSON.parse(lines[0]!), { event: "test_transcribed", model: "whisper-1", content_type: "audio/wav", bytes: 3, duration_s: 3.2, words: 5, segments: 1, no_speech: false });
  assertEquals(lines[0]!.includes("pending"), false);
});

Deno.test("assertTranscriptWasSpoken refuses a no-speech verdict and more words than the clip could hold", () => {
  assertTranscriptWasSpoken({ text: "Aaj mera kya pending hai", durationSeconds: 3.2, noSpeech: false });
  assertTranscriptWasSpoken({ text: "anything at all", durationSeconds: null, noSpeech: null });
  const silent = assertThrows(() => assertTranscriptWasSpoken({ text: "Thank you.", durationSeconds: 2, noSpeech: true }), VoiceTranscriptionError);
  assertEquals([silent.status, silent.message], [422, VOICE_NOT_HEARD_MESSAGE]);
  const invented = "one two three four five six seven eight nine ten eleven twelve";
  assertThrows(() => assertTranscriptWasSpoken({ text: invented, durationSeconds: 1, noSpeech: false }), VoiceTranscriptionError);
});

Deno.test("transcriptionModel defaults to whisper-1 and honours a configured model", () => {
  assertEquals(transcriptionModel(undefined), "whisper-1");
  assertEquals(transcriptionModel("  "), "whisper-1");
  assertEquals(transcriptionModel(" gpt-4o-transcribe "), "gpt-4o-transcribe");
});
