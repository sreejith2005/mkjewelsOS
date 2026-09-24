import { createClient } from "@supabase/supabase-js";
import {
  VOICE_HINTS_JSON_SCHEMA,
  VOICE_NOTE_MAX_BYTES,
  VoiceInterpretationError,
  buildExtractionInstructions,
  buildTranscriptionPrompt,
  interpretVoiceTask,
  type VoiceAudioUpload,
  type VoiceExtractionContext,
} from "./worker.ts";
import { deriveTaskAuthoringCapability } from "../../../packages/core/src/taskAuthoringCapabilities.ts";
import type { VoiceAssignmentCandidate } from "../../../packages/core/src/voiceTaskDraft.ts";
import {
  VOICE_DEADLINE_DEFAULT_TIME_ZONE,
  isValidTimeZone,
  zonedDateKey,
  zonedWallTimeToInstant,
  type VoiceDeadline,
} from "../../../packages/core/src/voiceDeadline.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

/**
 * Roles are never listed here. `tasks.voice_assign` (migration 0165) defaults to
 * super_admin, admin, manager and hr, and is adjustable per role, designation
 * and user in Settings -> Permissions; the database resolves it.
 */
const VOICE_TASK_PERMISSION = "tasks.voice_assign";
const OPEN_TASK_STATUSES = ["pending", "in_progress", "in_review", "blocked", "overdue"];

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { headers: corsHeaders, status });
}

async function callOpenAi(path: string, apiKey: string, init: RequestInit): Promise<unknown> {
  const result = await fetch(`https://api.openai.com/v1/${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${apiKey}` },
  });
  if (!result.ok) {
    // The provider body can echo request content; it never reaches the caller.
    console.error(`OpenAI ${path} failed with ${result.status}`);
    throw new VoiceInterpretationError(502, "Voice interpretation is unavailable right now");
  }
  return await result.json();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });

  // The token is passed to getUser explicitly, as every other admin function
  // does. Relying on a global header is unsafe: supabase-js seeds its auth
  // client with `Authorization: Bearer <anon key>`, and a lowercase
  // `authorization` header sits beside it rather than replacing it, so the
  // request carries two credentials and is rejected.
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(500, { error: "Voice interpretation is not configured" });
  if (!token) return response(401, { error: "Authentication required" });
  if (!openAiKey) return response(503, { error: "Voice interpretation is not configured" });

  const actorClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userError } = await actorClient.auth.getUser(token);
  if (userError || !userData.user) return response(401, { error: "Authentication required" });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("id,tenant_id,branch_id,department_id,designation_id,user_role")
    .eq("auth_user_id", userData.user.id)
    .eq("account_status", "active")
    .eq("is_login_enabled", true)
    .maybeSingle();
  if (profileError || !profile) return response(403, { error: "Active profile required" });

  // Asked as the caller: has_permission resolves the signed-in user through
  // auth.uid() and is the resolver authenticated users may execute. The
  // service role deliberately cannot execute permission_effective_for.
  // A failed check is reported as unavailable, never as a denial, so an
  // infrastructure fault cannot masquerade as a missing permission.
  const { data: permitted, error: permissionError } = await actorClient.rpc("has_permission", { p_key: VOICE_TASK_PERMISSION });
  if (permissionError) {
    console.error("Voice permission check failed", permissionError.message);
    return response(503, { error: "Unable to check your permissions right now" });
  }
  if (permitted !== true) return response(403, { error: "Your role cannot assign tasks by voice. Ask a Super Admin to enable it in Settings -> Permissions." });

  const { data: allowed, error: limitError } = await admin.rpc("consume_voice_interpretation_quota", { p_profile_id: profile.id });
  if (limitError) return response(503, { error: "Voice interpretation is unavailable right now" });
  if (allowed !== true) return response(429, { error: "Too many voice notes. Try again shortly." });

  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) return response(400, { error: "A recording is required" });
    if (audio.size > VOICE_NOTE_MAX_BYTES) return response(413, { error: "Keep the recording under 60 seconds" });
    const upload: VoiceAudioUpload = {
      bytes: new Uint8Array(await audio.arrayBuffer()),
      contentType: audio.type,
      filename: audio.name || "voice-note.webm",
    };

    // The single reference instant: every relative deadline in this note
    // ("tomorrow", "next Monday") is resolved against it, never the model's.
    const now = new Date();

    const [departmentsResult, peopleResult, designationResult, tenantResult] = await Promise.all([
      admin.from("departments").select("id,name,code,head_id").eq("tenant_id", profile.tenant_id).eq("is_active", true),
      admin.from("user_profiles")
        .select("id,employee_name,first_name,last_name,branch_id,department_id,account_status,working_status")
        .eq("tenant_id", profile.tenant_id)
        .in("account_status", ["active", "invited"])
        .eq("working_status", "active"),
      profile.designation_id
        ? admin.from("dropdown_masters").select("value").eq("id", profile.designation_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin.from("tenants").select("timezone").eq("id", profile.tenant_id).maybeSingle(),
    ]);
    if (departmentsResult.error || peopleResult.error) return response(503, { error: "Roster is unavailable right now" });

    // Mirrors the composer's assignee scope, designation included (a process
    // coordinator authors tenant-wide). The database stays the boundary: the
    // task RPC re-authorizes whoever the author finally submits.
    const scope = deriveTaskAuthoringCapability({ userRole: profile.user_role, designationValue: designationResult.data?.value ?? null }).scope;
    const people = peopleResult.data.filter((person) => {
      if (scope === "tenant") return true;
      if (scope === "branch") return person.branch_id === profile.branch_id;
      return person.department_id === profile.department_id;
    }).map((person) => ({
      ...person,
      employee_name: [person.first_name, person.last_name].filter((part) => Boolean(part?.trim())).join(" ") || person.employee_name || "",
    }));
    const departments = departmentsResult.data.filter((department) => people.some((person) => person.department_id === department.id));

    const tenantTimeZone = tenantResult.data?.timezone;
    const timeZone = isValidTimeZone(tenantTimeZone) ? tenantTimeZone : VOICE_DEADLINE_DEFAULT_TIME_ZONE;
    const todayKey = zonedDateKey(now, timeZone);

    const extraction: VoiceExtractionContext = {
      nowIso: now.toISOString(),
      timeZone,
      departmentLabels: departments.map((department) => department.code ? `${department.name} (${department.code})` : department.name),
      peopleNames: people.map((person) => person.employee_name).filter(Boolean),
    };

    const loadResolution = async (_hints: unknown, deadline: VoiceDeadline) => {
      const dueKey = deadline.date ?? todayKey;
      const dayStart = zonedWallTimeToInstant(dueKey, "00:00", timeZone) ?? `${dueKey}T00:00:00Z`;
      const dayEnd = new Date(Date.parse(zonedWallTimeToInstant(dueKey, "23:59", timeZone) ?? `${dueKey}T23:59:00Z`) + 59_999).toISOString();
      const [availabilityResult, loadResult] = await Promise.all([
        admin.from("user_availability").select("user_profile_id,status").eq("date", dueKey),
        admin.from("v_all_tasks").select("assignee_id")
          .eq("tenant_id", profile.tenant_id)
          .in("status", OPEN_TASK_STATUSES)
          .gte("planned_datetime", dayStart)
          .lte("planned_datetime", dayEnd),
      ]);
      const openCounts = new Map<string, number>();
      for (const row of loadResult.data ?? []) {
        if (row.assignee_id) openCounts.set(row.assignee_id, (openCounts.get(row.assignee_id) ?? 0) + 1);
      }
      const candidates: VoiceAssignmentCandidate[] = people.map((person) => ({
        id: person.id,
        employee_name: person.employee_name,
        branch_id: person.branch_id,
        department_id: person.department_id,
        account_status: person.account_status,
        working_status: person.working_status,
        open_task_count: openCounts.get(person.id) ?? 0,
      }));
      return { people: candidates, departments, availability: availabilityResult.data ?? [] };
    };

    const interpretation = await interpretVoiceTask({
      transcribe: async (input) => {
        const body = new FormData();
        body.append("file", new File([input.bytes as BlobPart], input.filename, { type: input.contentType }));
        // whisper-1 transcribes only what it hears and reports the audio's
        // duration and per-segment no-speech probability, which the worker uses
        // to refuse invented text. The gpt-4o transcribe models generate text
        // and, on a clip they cannot hear, write fluent content that was never
        // said; they remain available through OPENAI_TRANSCRIBE_MODEL.
        const model = Deno.env.get("OPENAI_TRANSCRIBE_MODEL")?.trim() || "whisper-1";
        const detailed = model === "whisper-1";
        body.append("model", model);
        body.append("response_format", detailed ? "verbose_json" : "json");
        body.append("temperature", "0");
        // Without a language the model auto-detects, and a quiet or noisy clip
        // comes back as invented text in an unrelated language. English is the
        // working language of the task form; OPENAI_TRANSCRIBE_LANGUAGE="auto"
        // restores detection, any other ISO-639-1 code overrides it.
        const language = Deno.env.get("OPENAI_TRANSCRIBE_LANGUAGE")?.trim() || "en";
        if (language !== "auto") body.append("language", language);
        const vocabulary = buildTranscriptionPrompt(extraction);
        if (vocabulary) body.append("prompt", vocabulary);
        const result = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", body, headers: { authorization: `Bearer ${openAiKey}` } });
        if (!result.ok) {
          console.error(`OpenAI transcription failed with ${result.status}`);
          throw new VoiceInterpretationError(502, "Voice interpretation is unavailable right now");
        }
        const payload = await result.json() as { text?: unknown; duration?: unknown; segments?: Array<{ no_speech_prob?: unknown; avg_logprob?: unknown }> };
        const text = typeof payload.text === "string" ? payload.text : "";
        const durationSeconds = typeof payload.duration === "number" ? payload.duration : null;
        const segments = Array.isArray(payload.segments) ? payload.segments : [];
        // Whisper's own verdict: every segment likely silence, or so unsure it
        // is guessing. Either way the words were not heard.
        const noSpeech = detailed && segments.length > 0
          ? segments.every((segment) => (typeof segment.no_speech_prob === "number" && segment.no_speech_prob > 0.6)
            || (typeof segment.avg_logprob === "number" && segment.avg_logprob < -1.2))
          : null;
        // Shape only, never the words: a voice note can carry personal content.
        console.log(JSON.stringify({ event: "voice_transcribed", model, content_type: input.contentType, bytes: input.bytes.byteLength, duration_s: durationSeconds, words: text.split(/\s+/).filter(Boolean).length, segments: segments.length, no_speech: noSpeech }));
        return { text, durationSeconds, noSpeech };
      },
      extract: async (transcript, context) => {
        const payload = await callOpenAi("chat/completions", openAiKey, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: Deno.env.get("OPENAI_EXTRACT_MODEL") ?? "gpt-4o-mini",
            temperature: 0,
            messages: [
              { role: "system", content: buildExtractionInstructions(context) },
              { role: "user", content: transcript },
            ],
            response_format: { type: "json_schema", json_schema: { name: "voice_task_hints", strict: true, schema: VOICE_HINTS_JSON_SCHEMA } },
          }),
        }) as { choices?: Array<{ message?: { content?: string } }> };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new VoiceInterpretationError(502, "The voice note could not be interpreted");
        try {
          return JSON.parse(content);
        } catch {
          throw new VoiceInterpretationError(502, "The voice note could not be interpreted");
        }
      },
    }, upload, loadResolution, extraction);

    // Audit the interpretation without the transcript: a voice note can carry
    // incidental personal content, and no task has been written yet.
    await admin.from("audit_logs").insert({
      tenant_id: profile.tenant_id,
      actor_user_id: profile.id,
      action: "task_voice_interpreted",
      module: "tasks",
      record_id: null,
      new_value: { audio_bytes: upload.bytes.byteLength, gaps: interpretation.gaps, resolved_assignee: interpretation.draft.assigneeId !== null, deadline_status: interpretation.draft.deadline.status },
    });

    return response(200, { ...interpretation });
  } catch (caught) {
    if (caught instanceof VoiceInterpretationError) return response(caught.status, { error: caught.message });
    console.error("Voice interpretation failed", caught instanceof Error ? caught.message : caught);
    return response(500, { error: "Unable to interpret the voice note" });
  }
});
