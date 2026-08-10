export type DeliveryChannel = "in_app" | "email" | "whatsapp" | "sms" | "push";
export type ClaimedDelivery = Readonly<{
  id: string;
  channel: DeliveryChannel;
  attempt_number: number;
  max_attempts: number;
}>;

export type AdapterResult = Readonly<{
  outcome: "delivered" | "blocked_configuration" | "failed";
  providerIdentifier: string;
  errorCategory: string | null;
  retryable: boolean;
}>;

export type OutboxGateway = Readonly<{
  detectScheduled: (limit: number) => Promise<void>;
  processEvents: (limit: number) => Promise<void>;
  claimDeliveries: (limit: number, workerId: string) => Promise<readonly ClaimedDelivery[]>;
  finishDelivery: (deliveryId: string, result: AdapterResult) => Promise<string>;
}>;

export const responseHeaders = {
  "Access-Control-Allow-Headers": "content-type,x-cron-secret",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
} as const;

function json(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export function adapterFor(channel: DeliveryChannel): AdapterResult {
  if (channel === "in_app") {
    return { outcome: "delivered", providerIdentifier: "jewelos_in_app", errorCategory: null, retryable: false };
  }
  return {
    outcome: "blocked_configuration",
    providerIdentifier: `${channel}_unavailable`,
    errorCategory: "provider_not_configured",
    retryable: false,
  };
}

export async function processBatch(gateway: OutboxGateway, batchSize: number, workerId: string) {
  await gateway.detectScheduled(batchSize);
  await gateway.processEvents(batchSize);
  const deliveries = await gateway.claimDeliveries(batchSize, workerId);
  const counts = { claimed: deliveries.length, delivered: 0, blocked_configuration: 0, retry_wait: 0, failed_terminal: 0 };
  for (const delivery of deliveries) {
    const result = adapterFor(delivery.channel);
    const state = await gateway.finishDelivery(delivery.id, result);
    if (state === "delivered") counts.delivered += 1;
    else if (state === "blocked_configuration") counts.blocked_configuration += 1;
    else if (state === "retry_wait") counts.retry_wait += 1;
    else counts.failed_terminal += 1;
  }
  return counts;
}

export async function handleOutboxRequest(
  request: Request,
  configuredSecret: string | undefined,
  gateway: OutboxGateway | null,
  workerId: string = crypto.randomUUID(),
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!configuredSecret || !gateway) return json(500, { error: "Function secrets are not configured" });
  if (request.headers.get("x-cron-secret") !== configuredSecret) return json(401, { error: "Scheduler authorization required" });
  let batchSize = 25;
  try {
    const body = request.headers.get("content-length") === "0" ? {} : await request.json() as { batch_size?: unknown };
    if (body.batch_size !== undefined) {
      if (!Number.isInteger(body.batch_size) || (body.batch_size as number) < 1 || (body.batch_size as number) > 100) {
        return json(400, { error: "batch_size must be an integer from 1 to 100" });
      }
      batchSize = body.batch_size as number;
    }
  } catch {
    return json(400, { error: "Invalid request" });
  }
  try {
    const counts = await processBatch(gateway, batchSize, workerId);
    return json(200, counts);
  } catch {
    return json(500, { error: "Notification processing failed" });
  }
}
