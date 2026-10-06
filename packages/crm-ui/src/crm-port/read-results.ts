/** Do not turn failed Supabase reads into successful empty CRM screens. */
export function assertCrmRead<T>(response: T): T {
  if (typeof response === "object" && response !== null && "error" in response && response.error) {
    const error = response.error;
    // Keep the original .single() missing-row path (the page renders its 404).
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "PGRST116")) throw error;
  }
  return response;
}

/** Preserve Promise.all's tuple types and the original query order. */
export async function readCrmResults<T extends readonly unknown[] | []>(reads: T) {
  const results = await Promise.all(reads);
  for (const response of results) assertCrmRead(response);
  return results;
}
