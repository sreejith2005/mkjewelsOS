// Google Sheets access with a service account. The only scope requested is
// spreadsheets.readonly: this code cannot change a sheet even if the account
// were given edit access by mistake.
import type { SheetReader } from "./worker.ts";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken(keyJson: string): Promise<string> {
  let key: { client_email?: string; private_key?: string };
  try { key = JSON.parse(keyJson); } catch { throw new Error("google_key_invalid"); }
  if (!key.client_email || !key.private_key) throw new Error("google_key_invalid");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 600,
  }))}`;
  let signature: ArrayBuffer;
  try {
    const cryptoKey = await crypto.subtle.importKey("pkcs8", pemToDer(key.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  } catch { throw new Error("google_key_invalid"); }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("google_auth_failed");
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("google_auth_failed");
  return data.access_token;
}

/** A reader for one tab of one spreadsheet. The token is fetched once per run. */
export function googleSheetReader(keyJson: string, spreadsheetId: string, tab: string): SheetReader {
  let token: Promise<string> | null = null;
  const quotedTab = `'${tab.replace(/'/g, "''")}'`;
  return {
    async rows(fromRow, toRow) {
      token ??= accessToken(keyJson);
      const range = encodeURIComponent(`${quotedTab}!${fromRow}:${toRow}`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}` +
        "?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE";
      const response = await fetch(url, { headers: { Authorization: `Bearer ${await token}` }, signal: AbortSignal.timeout(40_000) });
      if (response.status === 403) throw new Error("sheet_not_shared");
      if (response.status === 404) throw new Error("sheet_not_found");
      if (response.status === 400) throw new Error("sheet_tab_not_found");
      if (!response.ok) throw new Error("sheet_read_failed");
      const data = await response.json() as { values?: unknown[][] };
      return (data.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
    },
  };
}
