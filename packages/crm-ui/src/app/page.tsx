import { redirect } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

// crm-port: opening CRM lands on CLIENT QUEUE (owner request 2026-11-04): the queue, quick client
// registration and the lead button, with no registration-type chooser in between.
export default function HomePage() {
  redirect("/queue");
}
