import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Building2,
  CalendarCheck,
  CheckSquare,
  ClipboardList,
  FileSpreadsheet,
  GitBranch,
  Home,
  LayoutDashboard,
  ListFilter,
  Settings,
  Users,
} from "lucide-react";
import {
  canAccessPage, canBypassSectionMaintenance, DEFAULT_SECTION_CONTROLS, isSectionUnderMaintenance, validateSectionControls,
  getMenuForRole,
  getPageForPath,
  type PageId,
} from "@jewelos/core";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { supabase } from "@jewelos/api-client";
import { Button, Notice } from "@/components/ui";
import { ApplicationShell } from "@/components/shell/ApplicationShell";
import { LazyPageErrorBoundary } from "@/components/LazyPageErrorBoundary";
import { lazyPage } from "@/lib/lazyPage";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";
import { SectionMaintenanceNotice } from "@/components/SectionMaintenanceNotice";
import { saveSectionControls } from "@/features/settings/api";
import type { LauncherItem } from "@/components/shell/AppLauncher";
import logoDarkUrl from "../../../mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.41 (1).jpeg";
import logoLightUrl from "../../../mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.40 (1).jpeg";
import { Toaster, toast } from "sonner";

const AvailabilityPage = lazyPage("availability", () => import("@/pages/AvailabilityPage").then((module) => ({ default: module.AvailabilityPage })));
const HomePage = lazyPage("home", () => import("@/pages/HomePage").then((module) => ({ default: module.HomePage })));
const DashboardPage = lazyPage("dashboard", () => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const DropdownMasterPage = lazyPage("dropdown-master", () => import("@/pages/DropdownMasterPage").then((module) => ({ default: module.DropdownMasterPage })));
const FormsPage = lazyPage("forms", () => import("@/pages/FormsPage").then((module) => ({ default: module.FormsPage })));
const FMSBuilderPage = lazyPage("fms", () => import("@/pages/FMSBuilderPage").then((module) => ({ default: module.FMSBuilderPage })));
const NotificationsPage = lazyPage("notifications", () => import("@/pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const CRMPage = lazyPage("crm", () => import("@/pages/CRMPage").then((module) => ({ default: module.CRMPage })));
const TasksPage = lazyPage("tasks", () => import("@/pages/TasksPage").then((module) => ({ default: module.TasksPage })));
const RecurringTodoPage = lazyPage("recurring-todo", () => import("@/pages/RecurringTodoPage").then((module) => ({ default: module.RecurringTodoPage })));
const TaskBulkImportPage = lazyPage("task-bulk-import", () => import("@/pages/TaskBulkImportPage").then((module) => ({ default: module.TaskBulkImportPage })));
const TeamDirectoryPage = lazyPage("team-directory", () => import("@/pages/TeamDirectoryPage").then((module) => ({ default: module.TeamDirectoryPage })));
const ReportsPage = lazyPage("reports", () => import("@/pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const SettingsPage = lazyPage("settings", () => import("@/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

const PAGE_ICONS: Record<PageId, typeof Home> = {
  home: Home,
  dashboard: LayoutDashboard,
  crm: Users,
  checklist_tasks: CheckSquare,
  recurring_todo: CalendarCheck,
  delegation_tasks: ClipboardList,
  fms_tasks: GitBranch,
  fms_builder: GitBranch,
  forms_library: ClipboardList,
  meeting_ai: ClipboardList,
  notifications: ClipboardList,
  users: Users,
  availability: CalendarCheck,
  reports: FileSpreadsheet,
  dropdown_master: ListFilter,
  settings: Settings,
};

const IMPLEMENTED_PAGES = new Set<PageId>([
  "home",
  "dashboard",
  "checklist_tasks",
  "recurring_todo",
  "users",
  "availability",
  "dropdown_master",
  "forms_library",
  "fms_tasks",
  "fms_builder",
  "notifications",
  "crm",
  "reports",
  "settings",
]);

const FULL_WIDTH_PAGES = new Set<PageId>([
  "home",
  "dashboard",
  "crm",
  "checklist_tasks",
  "recurring_todo",
  "reports",
  "settings",
  "fms_builder",
  "fms_tasks",
]);

const APP_DESCRIPTIONS: Partial<Record<PageId, string>> = {
  home: "See today's authorized work, linked forms, FMS stages, and activity.",
  dashboard: "Review truthful operational analytics and transparent formulas.",
  crm: "Manage clients, walk-ins, interactions, follow-ups, and documents.",
  fms_tasks: "Run assigned stages and authorized workflows.",
  fms_builder: "Run live workflows and design versioned process flows.",
  users: "Browse employees by department and manage authorized accounts.",
  availability: "Record real working availability.",
  recurring_todo: "Manage recurring schedules, personal work, verification, follow-ups, and coverage.",
  dropdown_master: "Maintain active master values.",
  reports: "Preview fixed reports and manage private CSV exports.",
  settings: "Manage account preferences and authorized organization defaults.",
};

function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (nextPath: string) => {
    const nextUrl = new URL(nextPath, window.location.origin);
    if (`${nextUrl.pathname}${nextUrl.search}` !== `${window.location.pathname}${window.location.search}`) window.history.pushState({}, "", `${nextUrl.pathname}${nextUrl.search}`);
    setPath(nextUrl.pathname);
  };
  return { navigate, path };
}

function LoginPage() {
  const { signIn, statusMessage } = useAuth();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      setError(await signIn(username.trim(), password));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-obsidian px-5 py-10">
      <ThemeToggle className="absolute right-4 top-4" onChange={setTheme} theme={theme} />
      <section className="glass-card w-full max-w-md rounded-2xl p-7 sm:p-9">
        <img alt="MK Jewels" className="mx-auto mb-8 h-14 w-auto object-contain" src={logoDarkUrl} />
        <p className="mb-6 text-center text-sm text-soft-grey">Sign in to JewelOS</p>
        {statusMessage ? <div className="mb-5"><Notice tone="danger">{statusMessage}</Notice></div> : null}
        {error ? <div className="mb-5"><Notice tone="danger">{error}</Notice></div> : null}
        <form className="space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="label">Username</span>
            <input
              autoComplete="username"
              className="field"
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              required
              pattern="[a-z0-9]+"
              value={username}
            />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input
              autoComplete="current-password"
              className="field"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <Button className="mt-2 w-full" disabled={submitting} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-soft-grey">For a password reset, contact your Super Admin.</p>
        </form>
      </section>
    </main>
  );
}

function ResetPasswordPage() {
  const { logout, session } = useAuth();
  const { theme, setTheme } = useTheme();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    if (!session) return setError("This recovery link is invalid or has expired. Request a new one from sign in.");
    setError(null);
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) return setError(updateError.message);
    setSuccess(true);
  };

  return <main className="relative flex min-h-screen items-center justify-center bg-obsidian px-5 py-10">
    <ThemeToggle className="absolute right-4 top-4" onChange={setTheme} theme={theme} />
    <section className="glass-card w-full max-w-md rounded-2xl p-7 sm:p-9">
      <img alt="MK Jewels" className="mx-auto mb-8 h-14 w-auto object-contain" src={logoDarkUrl} />
      <h1 className="mb-2 text-center font-display text-2xl text-gold">Set your password</h1>
      <p className="mb-6 text-center text-sm text-soft-grey">Choose a new password for your JewelOS account.</p>
      {error ? <div className="mb-5"><Notice tone="danger">{error}</Notice></div> : null}
      {success ? <div className="space-y-5"><Notice tone="success">Password updated. You can now sign in.</Notice><Button className="w-full" onClick={() => void logout()}>Return to sign in</Button></div> : <form className="space-y-4" onSubmit={submit}>
        <label className="block"><span className="label">New password</span><input autoComplete="new-password" className="field" minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        <label className="block"><span className="label">Confirm new password</span><input autoComplete="new-password" className="field" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
        <Button className="mt-2 w-full" disabled={submitting} type="submit">{submitting ? "Updating…" : "Update password"}</Button>
      </form>}
    </section>
  </main>;
}

function IncompleteAccount() {
  const { logout, statusMessage } = useAuth();
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <section className="glass-card max-w-lg rounded-2xl p-8 text-center">
        <Building2 className="mx-auto mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-3xl text-gold">Account setup incomplete</h1>
        <p className="mt-3 text-sm text-champagne">{statusMessage}</p>
        <Button className="mt-6" onClick={() => void logout()} variant="secondary">Sign out</Button>
      </section>
    </main>
  );
}

function AppShell() {
  const { branch, logout, preferences, profile } = useAuth();
  const { theme, setTheme } = useTheme();
  const { navigate, path } = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [appsOpen, setAppsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sectionControls, setSectionControls] = useState(DEFAULT_SECTION_CONTROLS);
  const [savingSectionControls, setSavingSectionControls] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase.rpc("get_section_availability").then(({ data, error }) => {
      if (!active) return;
      // Maintenance controls are a convenience overlay, never an access-control
      // dependency. A stale deployment or a transient RPC failure must not stop a
      // signed-in employee from using otherwise authorized sections.
      if (error) { setSectionControls(DEFAULT_SECTION_CONTROLS); return; }
      try { setSectionControls(validateSectionControls(data)); } catch { setSectionControls(DEFAULT_SECTION_CONTROLS); }
    });
    return () => { active = false; };
  }, [profile?.id]);
  useEffect(() => {
    document.documentElement.dataset.tableDensity = preferences.table_density;
    return () => { delete document.documentElement.dataset.tableDensity; };
  }, [preferences.table_density]);
  const menu = useMemo(() => profile
    ? getMenuForRole(profile.user_role).filter((item) => IMPLEMENTED_PAGES.has(item.id))
    : [], [profile]);
  const nav = useMemo(() => menu.map((item) => ({
    ...item,
    Icon: PAGE_ICONS[item.id],
    label: item.label,
  })), [menu]);
  const launcherItems = useMemo<LauncherItem[]>(() => nav.flatMap((item) => {
    const description = APP_DESCRIPTIONS[item.id];
    return description ? [{ ...item, description }] : [];
  }), [nav]);
  if (!profile) return null;
  const isSuperAdmin = canBypassSectionMaintenance(profile.user_role);
  const persistSectionControls = async (nextControls: typeof sectionControls) => {
    setSavingSectionControls(true);
    try {
      setSectionControls(await saveSectionControls(nextControls));
    } catch {
      toast.error("Unable to save Developer Mode. Please refresh and retry.");
    } finally {
      setSavingSectionControls(false);
    }
  };
  const requestedPage = getPageForPath(path) ?? "home";
  const allowed = IMPLEMENTED_PAGES.has(requestedPage) && canAccessPage(profile.user_role, requestedPage);
  const currentPage: PageId = allowed ? requestedPage : "dashboard";
  const sectionUnderMaintenance = !isSuperAdmin && isSectionUnderMaintenance(sectionControls, currentPage);
  const pageContent = sectionUnderMaintenance ? <SectionMaintenanceNotice section={currentPage === "checklist_tasks" ? "Tasks" : currentPage === "forms_library" ? "Forms Library" : currentPage === "fms_builder" ? "FMS" : currentPage === "dropdown_master" ? "Dropdown Master" : currentPage === "fms_tasks" ? "FMS Tasks" : currentPage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} /> : currentPage === "home" ? <HomePage onNavigate={navigate} />
    : currentPage === "dashboard" ? <DashboardPage />
    : currentPage === "reports" ? <ReportsPage />
    : currentPage === "settings" ? <SettingsPage />
    : currentPage === "users" ? <TeamDirectoryPage />
    : currentPage === "crm" ? <CRMPage />
    : currentPage === "dropdown_master" ? <DropdownMasterPage />
      : currentPage === "checklist_tasks" ? path === "/tasks/import" ? <TaskBulkImportPage onBack={() => navigate("/tasks")} /> : <TasksPage />
      : currentPage === "recurring_todo" ? <RecurringTodoPage />
      : currentPage === "availability" ? <AvailabilityPage />
          : currentPage === "forms_library" ? <FormsPage />
            : currentPage === "fms_tasks" ? <FMSBuilderPage />
              : currentPage === "fms_builder" ? <FMSBuilderPage />
                : currentPage === "notifications" ? <NotificationsPage onNavigate={navigate} />
            : <DashboardPage />;

  return (
    <ApplicationShell
      appsOpen={appsOpen}
      branch={branch}
      currentPage={currentPage}
      developerModeActive={isSuperAdmin && sectionControls.developer_mode_enabled}
      developerModeControl={isSuperAdmin ? <button aria-checked={sectionControls.developer_mode_enabled} className={`relative flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition ${sectionControls.developer_mode_enabled ? "border-gold bg-gold text-obsidian" : "border-gold/30 text-gold hover:bg-gold/10"}`} disabled={savingSectionControls} onClick={() => void persistSectionControls({ ...sectionControls, developer_mode_enabled: !sectionControls.developer_mode_enabled })} role="switch" type="button"><span className={`size-2 rounded-full ${sectionControls.developer_mode_enabled ? "bg-obsidian" : "bg-task-text-muted"}`} />Developer Mode</button> : undefined}
      developerSectionControls={isSuperAdmin ? <nav aria-label="Developer Mode section controls" className="flex gap-2 overflow-x-auto pb-1">{nav.map((item) => <label className="flex shrink-0 items-center gap-2 rounded-full border border-gold/20 px-3 py-1.5 text-xs text-champagne" key={item.id}><span>{item.label}</span><button aria-checked={sectionControls.section_availability[item.id]} aria-label={`${item.label} availability`} className={`relative h-5 w-9 rounded-full transition ${sectionControls.section_availability[item.id] ? "bg-success" : "bg-task-overdue"}`} disabled={savingSectionControls} onClick={() => void persistSectionControls({ ...sectionControls, section_availability: { ...sectionControls.section_availability, [item.id]: !sectionControls.section_availability[item.id] } })} role="switch" type="button"><span className={`absolute top-0.5 size-4 rounded-full bg-task-bg transition ${sectionControls.section_availability[item.id] ? "left-4" : "left-0.5"}`} /></button></label>)}</nav> : undefined}
      launcherItems={launcherItems}
      logoDarkUrl={logoDarkUrl}
      logoLightUrl={logoLightUrl}
      moreOpen={moreOpen}
      nav={nav}
      navigate={navigate}
      onAppsOpenChange={setAppsOpen}
      onLogout={logout}
      onMoreOpenChange={setMoreOpen}
      path={path}
      profile={profile}
      setSidebarOpen={setSidebarOpen}
      sidebarOpen={sidebarOpen}
      theme={theme}
      onThemeChange={setTheme}
      fullBleed={FULL_WIDTH_PAGES.has(currentPage)}
    >
      <LazyPageErrorBoundary onNavigate={navigate} resetKey={path}><Suspense fallback={<div className="flex min-h-48 items-center justify-center text-gold">Loading…</div>}>{pageContent}</Suspense></LazyPageErrorBoundary>
    </ApplicationShell>
  );
}

function AuthenticatedApp() {
  const { status } = useAuth();
  if (status === "loading") {
    return <main className="flex min-h-screen items-center justify-center text-gold">Loading JewelOS…</main>;
  }
  if (status === "incomplete") return <IncompleteAccount />;
  if (status !== "authenticated") return <LoginPage />;
  return <AppShell />;
}

export function App() {
  return (
    <ThemeProvider><AuthProvider>{window.location.pathname === "/reset-password" ? <ResetPasswordPage /> : <AuthenticatedApp />}<Toaster position="bottom-right" richColors theme="dark" /></AuthProvider></ThemeProvider>
  );
}
