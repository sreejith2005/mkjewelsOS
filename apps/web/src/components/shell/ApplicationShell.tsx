import type { ComponentType, ReactNode } from "react";
import { Menu, PanelLeftClose } from "lucide-react";
import type { PageId } from "@jewelos/core";
import { Button } from "@/components/ui";
import { initials, titleCase } from "@/lib/format";
import type { Branch, UserProfile } from "@/types";
import { cn } from "@/lib/utils";
import { AppLauncher, type LauncherItem } from "./AppLauncher";
import { MobileBottomNav } from "./MobileBottomNav";
import { MoreSheet } from "./MoreSheet";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { ThemeToggle, type Theme } from "@/components/ThemeToggle";

export type ShellNavItem = Readonly<{
  Icon: ComponentType<{ className?: string }>;
  id: PageId;
  label: string;
  path: string;
}>;

const SIDEBAR_BOTTOM_PAGE_IDS = new Set<PageId>(["dropdown_master", "reports", "settings"]);

export function getSidebarNavigation(nav: readonly ShellNavItem[]): Readonly<{ primary: readonly ShellNavItem[]; bottom: readonly ShellNavItem[] }> {
  const primary = nav.filter((item) => item.id !== "notifications" && !SIDEBAR_BOTTOM_PAGE_IDS.has(item.id) && item.id !== "users");
  const users = nav.filter((item) => item.id === "users");
  return {
    primary: [...primary, ...users],
    bottom: nav.filter((item) => SIDEBAR_BOTTOM_PAGE_IDS.has(item.id)),
  };
}

export function ApplicationShell({
  appsOpen,
  branch,
  children,
  currentPage,
  developerModeActive = false,
  developerModeControl,
  developerSectionControls,
  launcherItems,
  logoDarkUrl,
  logoLightUrl,
  moreOpen,
  nav,
  navigate,
  onAppsOpenChange,
  onLogout,
  onMoreOpenChange,
  path,
  profile,
  sidebarOpen,
  setSidebarOpen,
  theme,
  onThemeChange,
  fullBleed = false,
}: {
  appsOpen: boolean;
  branch: Branch | null;
  children: ReactNode;
  currentPage: PageId;
  developerModeActive?: boolean;
  developerModeControl?: ReactNode;
  developerSectionControls?: ReactNode;
  launcherItems: readonly LauncherItem[];
  logoDarkUrl: string;
  logoLightUrl: string;
  moreOpen: boolean;
  nav: readonly ShellNavItem[];
  navigate: (path: string) => void;
  onAppsOpenChange: (open: boolean) => void;
  onLogout: () => Promise<void>;
  onMoreOpenChange: (open: boolean) => void;
  path: string;
  profile: UserProfile;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  fullBleed?: boolean;
}) {
  const sidebarNavigation = getSidebarNavigation(nav);

  return (
    <div className="min-h-screen bg-obsidian">
      <header className={cn("sticky top-0 z-30 flex items-center border-b border-task-border bg-task-bg px-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:fixed md:inset-x-0 md:border-gold/20 md:bg-charcoal/95 md:px-5 md:backdrop-blur", developerModeActive ? "min-h-14 flex-wrap py-2 md:min-h-16" : "h-14 md:h-16")}>
        <div className="flex w-full items-center">
        <Button aria-label="Toggle sidebar" className="mr-3 hidden size-10 p-0 md:inline-flex" onClick={() => setSidebarOpen(!sidebarOpen)} variant="ghost">
          {sidebarOpen ? <PanelLeftClose /> : <Menu />}
        </Button>
        <img alt="MK Jewels" className="h-7 w-28 object-contain object-left md:hidden" src={logoLightUrl} />
        <img alt="MK Jewels" className="hidden h-8 w-auto md:block" src={logoDarkUrl} />
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <span className="hidden text-sm text-champagne md:inline">{branch?.name ?? "Branch unavailable"}</span>
          {developerModeControl}
          <ThemeToggle onChange={onThemeChange} theme={theme} />
          <NotificationBell onNavigate={navigate} profileId={profile.id} />
          <button
            aria-label="Open more navigation"
            className="flex size-10 items-center justify-center rounded-full bg-task-accent-soft text-sm font-bold text-task-text md:rounded-lg md:border md:border-gold/20 md:bg-obsidian md:text-gold"
            onClick={() => onMoreOpenChange(true)}
            type="button"
          >
            {initials(profile.employee_name)}
          </button>
          <div className="hidden sm:block">
            <p className="max-w-36 truncate text-xs font-semibold text-white">{profile.employee_name}</p>
            <p className="text-[10px] uppercase tracking-wider text-gold">{titleCase(profile.user_role)}</p>
          </div>
        </div>
        </div>
        {developerModeActive && developerSectionControls ? <div className="mt-2 w-full border-t border-gold/20 pt-2">{developerSectionControls}</div> : null}
      </header>

      <aside className={cn("fixed bottom-0 left-0 top-16 z-20 hidden w-64 flex-col border-r border-gold/20 bg-charcoal p-3 transition-transform md:flex", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {sidebarNavigation.primary.map(({ Icon, ...item }) => (
            <button
              className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition", currentPage === item.id ? "bg-gold text-obsidian" : "text-champagne hover:bg-gold/10 hover:text-gold")}
              key={item.id}
              onClick={() => navigate(item.path)}
              type="button"
            >
              <Icon className="size-4 shrink-0" />{item.label}
            </button>
          ))}
        </nav>
        {sidebarNavigation.bottom.length > 0 ? <nav aria-label="System navigation" className="mt-3 flex flex-col gap-1 border-t border-gold/20 pt-3">
          {sidebarNavigation.bottom.map(({ Icon, ...item }) => (
            <button
              className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition", currentPage === item.id ? "bg-gold text-obsidian" : "text-champagne hover:bg-gold/10 hover:text-gold")}
              key={item.id}
              onClick={() => navigate(item.path)}
              type="button"
            >
              <Icon className="size-4 shrink-0" />{item.label}
            </button>
          ))}
        </nav> : null}
      </aside>

      <main className={cn("pb-mobile-nav min-h-[calc(100dvh-3.5rem)] md:min-h-screen md:pt-16 md:transition-[padding]", developerModeActive && "md:pt-28", sidebarOpen && "md:pl-64")}>
        <div className={cn(fullBleed ? "w-full p-4 sm:p-6 [&>section]:max-w-none [&>section]:mx-0" : "mx-auto max-w-7xl p-4 sm:p-6")}>{children}</div>
      </main>

      <MobileBottomNav onNavigate={navigate} onOpenApps={() => onAppsOpenChange(true)} onOpenMore={() => onMoreOpenChange(true)} path={path} />
      {appsOpen ? <AppLauncher items={launcherItems} onClose={() => onAppsOpenChange(false)} onNavigate={navigate} /> : null}
      {moreOpen ? <MoreSheet branchName={branch?.name ?? "Branch unavailable"} items={launcherItems} onClose={() => onMoreOpenChange(false)} onLogout={onLogout} onNavigate={navigate} profileName={profile.employee_name} roleLabel={titleCase(profile.user_role)} /> : null}
    </div>
  );
}
