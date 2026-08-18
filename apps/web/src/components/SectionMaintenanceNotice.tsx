import { Construction } from "lucide-react";
import { PageSurface } from "@/features/analytics/components";

export function SectionMaintenanceNotice({ section }: { section: string }) {
  return <PageSurface><div className="mx-auto flex min-h-[55dvh] max-w-lg flex-col items-center justify-center text-center"><span className="flex size-16 items-center justify-center rounded-2xl bg-task-accent-soft text-task-accent"><Construction className="size-8" /></span><h1 className="mt-5 text-2xl font-semibold">{section} is being improved</h1><p className="mt-2 text-sm text-task-text-muted">This section is temporarily unavailable while we make an update. Please check back shortly.</p></div></PageSurface>;
}
