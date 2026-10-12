import { assertEquals } from "@std/assert";
import { KIARA_TRANSCRIPTION_PROMPT, handleKiaraTranscribe, kiaraRoute, type KiaraTranscribeDeps } from "./transcribe.ts";
import type { ActorClient, RpcResult } from "./tools/index.ts";

type Call = { fn: string; args: unknown };

function actor(results: Record<string, RpcResult>): { actor: ActorClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    actor: {
      rpc: (fn, args) => {
        calls.push({ fn, args });
        return Promise.resolve(results[fn] ?? { data: null, error: { code: "PGRST202", message: "missing" } });
      },
      select: () => Promise.reject(new Error("not used")),
    },
  };
}

const allowed = { has_permission: { data: true, error: null }, consume_my_voice_quota: { data: true, error: null } };

function provider(...payloads: unknown[]): { fetch: typeof fetch; forms: FormData[] } {
  const forms: FormData[] = [];
  const fake = ((_url: string | URL | Request, init?: RequestInit) => {
    forms.push(init?.body as FormData);
    const payload = payloads[Math.min(forms.length - 1, payloads.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
  }) as typeof fetch;
  return { fetch: fake, forms };
}

function recording(type = "audio/wav", bytes = 3): Request {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array(bytes)], "voice-question.wav", { type }));
  return new Request("http://local/ask-kiara/transcribe", { method: "POST", body: form });
}

function deps(rpc: ReturnType<typeof actor>, fake: ReturnType<typeof provider>): KiaraTranscribeDeps {
  return { actor: rpc.actor, openAiKey: "test-key", model: "whisper-1", fetch: fake.fetch, log: () => {} };
}

const spoken = (text: string, language: string) => ({ text, duration: 4, language, segments: [{ no_speech_prob: 0.02, avg_logprob: -0.3 }] });

Deno.test("transcribe auto-detects the language and returns the words for editing", async () => {
  const rpc = actor(allowed);
  const fake = provider(spoken(" Aaj mera kya pending hai? ", "hindi"));
  const result = await handleKiaraTranscribe(recording(), deps(rpc, fake));
  assertEquals(result, { status: 200, body: { text: "Aaj mera kya pending hai?", duration_s: 4, language: "hindi" } });
  assertEquals(fake.forms.length, 1);
  assertEquals(fake.forms[0]!.has("language"), false);
  assertEquals(fake.forms[0]!.get("prompt"), KIARA_TRANSCRIPTION_PROMPT);
  assertEquals(rpc.calls.map((call) => call.fn), ["has_permission", "consume_my_voice_quota"]);
  assertEquals(rpc.calls[0]!.args, { p_key: "assistant.voice" });
});

Deno.test("transcribe never calls the chat path: no Kiara turn is started", async () => {
  const rpc = actor(allowed);
  await handleKiaraTranscribe(recording(), deps(rpc, provider(spoken("How do I apply for leave?", "english"))));
  assertEquals(rpc.calls.some((call) => call.fn === "start_kiara_turn"), false);
});

Deno.test("transcribe retries a clip whisper labelled Urdu as Hindi, spending the allowance once", async () => {
  const rpc = actor(allowed);
  const fake = provider(spoken("آج میرا کیا پینڈنگ ہے", "urdu"), spoken("आज मेरा क्या पेंडिंग है", "hindi"));
  const result = await handleKiaraTranscribe(recording(), deps(rpc, fake));
  assertEquals(result, { status: 200, body: { text: "आज मेरा क्या पेंडिंग है", duration_s: 4, language: "hindi" } });
  assertEquals(fake.forms.map((form) => form.get("language")), [null, "hi"]);
  assertEquals(rpc.calls.filter((call) => call.fn === "consume_my_voice_quota").length, 1);
});

Deno.test("transcribe refuses a caller without assistant.voice before touching the provider or the allowance", async () => {
  const rpc = actor({ ...allowed, has_permission: { data: false, error: null } });
  const fake = provider(spoken("hello", "english"));
  const result = await handleKiaraTranscribe(recording(), deps(rpc, fake));
  assertEquals(result.status, 403);
  assertEquals((result.body as { code: string }).code, "forbidden");
  assertEquals(fake.forms.length, 0);
  assertEquals(rpc.calls.map((call) => call.fn), ["has_permission"]);
});

Deno.test("transcribe reports a failed permission check as unavailable, not as a denial", async () => {
  const rpc = actor({ ...allowed, has_permission: { data: null, error: { code: "08006", message: "down" } } });
  const result = await handleKiaraTranscribe(recording(), deps(rpc, provider()));
  assertEquals([result.status, (result.body as { code: string }).code], [503, "unavailable"]);
});

Deno.test("transcribe maps the database's own denial (section off or no voice) to 403", async () => {
  const section = actor({ ...allowed, consume_my_voice_quota: { data: null, error: { code: "42501", message: "This section is currently unavailable" } } });
  const sectionResult = await handleKiaraTranscribe(recording(), deps(section, provider()));
  assertEquals([sectionResult.status, (sectionResult.body as { error: string }).error], [403, "You do not have access to Ask Kiara."]);
  const voice = actor({ ...allowed, consume_my_voice_quota: { data: null, error: { code: "42501", message: "Voice questions are not enabled for your account" } } });
  const voiceResult = await handleKiaraTranscribe(recording(), deps(voice, provider()));
  assertEquals(voiceResult.status, 403);
  assertEquals((voiceResult.body as { error: string }).error.startsWith("Voice questions are not enabled"), true);
});

Deno.test("transcribe answers 429 when the hourly voice allowance shared with Tasks is spent", async () => {
  const rpc = actor({ ...allowed, consume_my_voice_quota: { data: false, error: null } });
  const fake = provider(spoken("hello", "english"));
  const result = await handleKiaraTranscribe(recording(), deps(rpc, fake));
  assertEquals([result.status, (result.body as { code: string }).code], [429, "voice_limit_reached"]);
  assertEquals(fake.forms.length, 0);
});

Deno.test("transcribe refuses a bad upload without spending the allowance", async () => {
  for (const [request, status] of [[recording("application/pdf"), 415], [recording("audio/wav", 0), 400], [recording("audio/wav", 2_621_441), 413]] as const) {
    const rpc = actor(allowed);
    const result = await handleKiaraTranscribe(request, deps(rpc, provider()));
    assertEquals(result.status, status);
    assertEquals(rpc.calls.some((call) => call.fn === "consume_my_voice_quota"), false);
  }
  const empty = new Request("http://local/ask-kiara/transcribe", { method: "POST", body: new FormData() });
  assertEquals((await handleKiaraTranscribe(empty, deps(actor(allowed), provider()))).status, 400);
});

Deno.test("transcribe refuses silence instead of inventing a question (no-speech guard)", async () => {
  const silent = await handleKiaraTranscribe(recording(), deps(actor(allowed), provider({ text: "Thank you.", duration: 3, language: "english", segments: [{ no_speech_prob: 0.92, avg_logprob: -0.4 }] })));
  assertEquals([silent.status, (silent.body as { code: string }).code], [422, "no_speech"]);
  const empty = await handleKiaraTranscribe(recording(), deps(actor(allowed), provider({ text: "  ", duration: 3, language: "english", segments: [] })));
  assertEquals([empty.status, (empty.body as { code: string }).code], [422, "no_speech"]);
  // Twelve words in one second could not have been said.
  const invented = await handleKiaraTranscribe(recording(), deps(actor(allowed), provider({ text: "one two three four five six seven eight nine ten eleven twelve", duration: 1, language: "english", segments: [] })));
  assertEquals([invented.status, (invented.body as { code: string }).code], [422, "no_speech"]);
});

Deno.test("transcribe hides provider failures behind a safe message", async () => {
  const failing = ((_url: string | URL | Request) => Promise.resolve(new Response("{\"error\":\"echo\"}", { status: 500 }))) as typeof fetch;
  const result = await handleKiaraTranscribe(recording(), { actor: actor(allowed).actor, openAiKey: "k", model: "whisper-1", fetch: failing, log: () => {} });
  assertEquals([result.status, (result.body as { code: string }).code], [502, "provider_error"]);
  assertEquals((result.body as { error: string }).error.includes("echo"), false);
});

Deno.test("the function routes /ask-kiara/transcribe to the transcribe handler and keeps the chat paths", () => {
  assertEquals(kiaraRoute("/functions/v1/ask-kiara/transcribe"), "transcribe");
  assertEquals(kiaraRoute("/ask-kiara/transcribe/"), "transcribe");
  assertEquals(kiaraRoute("/functions/v1/ask-kiara"), "chat");
  assertEquals(kiaraRoute("/ask-kiara/chat"), "chat");
  assertEquals(kiaraRoute("/ask-kiara/other"), null);
});

Deno.test("index.ts sends the transcribe route to handleKiaraTranscribe", async () => {
  // A source-level guard: the route must be wired in the entry point, not only tested here.
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(source.includes("kiaraRoute(new URL(request.url).pathname)"), true);
  assertEquals(source.includes("handleKiaraTranscribe(request,"), true);
});
