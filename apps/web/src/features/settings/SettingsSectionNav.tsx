import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Section = Readonly<{ id: string; label: string }>;

/** Settings sections carry an id starting with this prefix; the bar lists the ones on the page. */
export const SETTINGS_SECTION_PREFIX = "settings-";

const readSections = (): Section[] => [...document.querySelectorAll<HTMLElement>(`[id^="${SETTINGS_SECTION_PREFIX}"]`)]
  .map((element) => ({ id: element.id, label: element.dataset.sectionLabel ?? element.querySelector("h2, summary")?.textContent?.trim() ?? "" }))
  .filter((section) => section.label);

/**
 * "Jump to" bar for the long Settings page. It lists only the sections that
 * actually rendered, so it follows the viewer's permissions without repeating
 * any permission rule here.
 */
export function SettingsSectionNav() {
  const [sections, setSections] = useState<Section[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setSections((previous) => {
      const next = readSections();
      return next.length === previous.length && next.every((section, index) => section.id === previous[index]?.id && section.label === previous[index]?.label) ? previous : next;
    });
    update();
    const root = document.querySelector("main") ?? document.body;
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    observer?.observe(root, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);
  if (sections.length < 3) return null;
  const jump = (id: string) => {
    setCurrent(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  return <nav aria-label="Settings sections" className="sticky top-[calc(3.5rem_+_env(safe-area-inset-top))] z-20 -mx-4 mb-4 border-b border-task-border bg-task-muted/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:top-16">
    <div className="scroll-x no-scrollbar flex gap-1.5">
      {sections.map((section) => <button aria-current={current === section.id ? "true" : undefined} className={cn("min-h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors", current === section.id ? "border-gold bg-gold/10 text-task-text" : "border-task-border bg-task-bg text-task-text-muted hover:border-gold/50 hover:text-task-text")} key={section.id} onClick={() => jump(section.id)} type="button">{section.label}</button>)}
    </div>
  </nav>;
}
