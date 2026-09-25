export function phoneDigits(value: string) { return value.replace(/\D/g, "").slice(-10); }
export function displayDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value)) : "—"; }
export function nullable(value: string) { const trimmed = value.trim(); return trimmed || null; }
export function stringArray(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
