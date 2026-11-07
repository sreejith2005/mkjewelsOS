import { useEffect, useRef } from "react";
import { hasPermission } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { CoachingView } from "@/features/storeIntelligence/CoachingView";
import { ConversationDetail } from "@/features/storeIntelligence/ConversationDetail";
import { ConversationsView } from "@/features/storeIntelligence/ConversationsView";
import { DevicesView } from "@/features/storeIntelligence/DevicesView";
import { InsightsView } from "@/features/storeIntelligence/InsightsView";
import { RecordFlow } from "@/features/storeIntelligence/RecordFlow";
import { parseSiRoute, siPath, type SiView } from "@/features/storeIntelligence/routes";
import { SettingsView } from "@/features/storeIntelligence/SettingsView";
import { TodayView } from "@/features/storeIntelligence/TodayView";
import { TabBar } from "@/features/storeIntelligence/ui";

type TopTab = Exclude<SiView, "record" | "conversation">;

/**
 * Store Intelligence. Salespeople see Today and Conversations; managers also see
 * Coaching, Insights and Devices; Settings is for those who can configure or
 * review. Hidden tabs are a convenience: every read is authorized by the server.
 */
export function StoreIntelligencePage({ path, search, navigate }: { path: string; search: string; navigate: (path: string) => void }) {
  const { access } = useAuth();
  const route = parseSiRoute(path, search);
  const role = access?.effectiveRole ?? "";
  const isReviewer = hasPermission(access, "recording.review") && ["super_admin", "admin", "manager"].includes(role);
  const canSettings = isReviewer || hasPermission(access, "recording.manage_rubric") || hasPermission(access, "developer_mode.manage");
  const canRecord = hasPermission(access, "recording.capture");
  const tabs: { id: TopTab; label: string; href: string }[] = [
    { id: "today", label: "Today", href: siPath.today() },
    { id: "conversations", label: "Conversations", href: siPath.conversations() },
    ...(isReviewer ? [
      { id: "coaching" as const, label: "Coaching", href: siPath.coaching() },
      { id: "insights" as const, label: "Insights", href: siPath.insights() },
      { id: "devices" as const, label: "Devices", href: siPath.devices() },
    ] : []),
    ...(canSettings ? [{ id: "settings" as const, label: "Settings", href: siPath.settings() }] : []),
  ];
  const managerOnly = (["coaching", "insights", "devices"] as SiView[]).includes(route.view) && !isReviewer;
  const view: SiView = managerOnly || (route.view === "settings" && !canSettings) ? "today" : route.view;
  const current: TopTab = view === "conversation" ? "conversations" : view === "record" ? "today" : view;

  // Move focus to the new screen's heading so screen readers announce it.
  const main = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const frame = requestAnimationFrame(() => {
      const heading = main.current?.querySelector<HTMLElement>("h1");
      if (!heading) return;
      heading.setAttribute("tabindex", "-1"); heading.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [view, route.sessionId]);

  return <div className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted px-4 pb-10 pt-3 text-task-text sm:-m-6 sm:px-6 md:min-h-[calc(100vh-4rem)]">
    <div className="mx-auto max-w-5xl space-y-4">
      {view !== "record" ? <div className="-mx-1">
        <TabBar current={current} items={tabs} label="Store Intelligence" onSelect={(id) => navigate(tabs.find((tab) => tab.id === id)!.href)} />
      </div> : <a className="inline-flex min-h-11 items-center text-sm font-semibold text-task-text-muted hover:text-task-text" href={siPath.today()} onClick={(event) => { event.preventDefault(); navigate(siPath.today()); }}>← Store Intelligence</a>}
      {managerOnly ? <p className="rounded-xl border border-task-border bg-task-bg p-3 text-sm text-task-text-muted" role="status">That view is for managers. Showing Today instead.</p> : null}
      <div className="[&_h1]:outline-none" ref={main}>
        {view === "today" ? <TodayView canRecordUi={canRecord} navigate={navigate} />
          : view === "record" ? <RecordFlow navigate={navigate} />
          : view === "conversations" ? <ConversationsView isReviewer={isReviewer} navigate={navigate} search={search} />
          : view === "conversation" && route.sessionId ? <ConversationDetail key={route.sessionId} navigate={navigate} sessionId={route.sessionId} tab={route.tab} />
          : view === "coaching" ? <CoachingView navigate={navigate} range={route.range} />
          : view === "insights" ? <InsightsView navigate={navigate} search={search} view={route.insight} />
          : view === "devices" ? <DevicesView navigate={navigate} />
          : <SettingsView navigate={navigate} />}
      </div>
    </div>
  </div>;
}
