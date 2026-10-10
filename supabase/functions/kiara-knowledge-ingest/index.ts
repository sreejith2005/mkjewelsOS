import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import mammoth from "mammoth";
import { parseIngestRequest, runIngest, type IngestDeps } from "./worker.ts";

/**
 * POST /functions/v1/kiara-knowledge-ingest  { "version_id": "<uuid>" }
 *
 * verify_jwt stays on. The caller's JWT is used for every database call and for
 * the download (the storage policy allows reads only to knowledge managers);
 * this function never reads the service-role key.
 */
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const json = (status: number, body: Readonly<Record<string, unknown>>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));

// Images are not read (spec 10); skipping their base64 encoding also keeps CPU
// time well inside the edge-runtime limit for picture-heavy documents.
const skipImages = mammoth.images.imgElement(() => Promise.resolve({ src: "" }));

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed", code: "invalid_request" });
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token) return json(401, { error: "Authentication required", code: "unauthenticated" });
  if (!supabaseUrl || !anonKey) return json(503, { error: "The knowledge base is not configured", code: "unavailable" });

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "Authentication required", code: "unauthenticated" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request", code: "invalid_request" });
  }
  const versionId = parseIngestRequest(body);
  if (!versionId) return json(400, { error: "Invalid request", code: "invalid_request" });

  const deps: IngestDeps = {
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    download: async (path) => {
      const { data, error } = await client.storage.from("kiara-knowledge").download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    // mammoth's Node entry reads a Buffer; this one shares the downloaded bytes (no copy).
    extractHtml: async (bytes) => (await mammoth.convertToHtml({ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) }, { convertImage: skipImages })).value,
    log,
  };
  const result = await runIngest(deps, versionId);
  return json(result.status, result.body);
});
