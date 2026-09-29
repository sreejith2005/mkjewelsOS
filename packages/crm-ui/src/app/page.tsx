import { redirect } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

export default function HomePage() {
  redirect("/queue");
}
