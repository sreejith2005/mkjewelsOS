import { redirect } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

// crm-port: opening CRM lands on CLIENT QUEUE (owner request 2026-11-04). REGISTRATION stays at
// /queue, so its links and every other /crm deep link are unchanged.
export default function HomePage() {
  redirect("/queue?register=client");
}
