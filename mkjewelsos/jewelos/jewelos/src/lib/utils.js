/* Small date + formatting helpers. Dependency-free on purpose so the bundle
   stays lean; swap for date-fns if you later need locale handling. */

export const pad = (n) => String(n).padStart(2, "0");
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const TODAY = new Date();
export const TODAY_ISO = toISO(TODAY);

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtDate = (iso) => {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const fmtDateLong = (iso) => {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const relDays = (iso) => {
  if (!iso) return "";
  const diff = Math.round((new Date(iso) - new Date(TODAY_ISO)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff < 0 ? `${Math.abs(diff)}d overdue` : `in ${diff}d`;
};

export const inr = (n) => `\u20b9${Number(n || 0).toLocaleString("en-IN")}`;
export const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export const initials = (name = "") =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export const pctDone = (cl = []) =>
  cl.length ? Math.round((cl.filter((i) => i.done).length / cl.length) * 100) : 0;

export const PRIORITY = {
  urgent: { chip: "bg-rose-100 text-rose-700", bar: "bg-rose-500", label: "Urgent" },
  high: { chip: "bg-amber-100 text-amber-700", bar: "bg-amber-500", label: "High" },
  medium: { chip: "bg-blue-100 text-blue-700", bar: "bg-blue-500", label: "Medium" },
  low: { chip: "bg-slate-100 text-slate-600", bar: "bg-slate-400", label: "Low" },
};

export const CUSTOMER_TYPE = {
  vip: "bg-amber-100 text-amber-800",
  regular: "bg-slate-100 text-slate-700",
  wholesale: "bg-violet-100 text-violet-800",
  corporate: "bg-blue-100 text-blue-800",
};
