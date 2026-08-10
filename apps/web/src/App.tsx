import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
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
  canAccessPage,
  getMenuForRole,
  getPageForPath,
  type PageId,
} from "@jewelos/core";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { ApplicationShell } from "@/components/shell/ApplicationShell";
import { LazyPageErrorBoundary } from "@/components/LazyPageErrorBoundary";
import type { LauncherItem } from "@/components/shell/AppLauncher";
import logoDarkUrl from "../../../mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.41 (1).jpeg";
import logoLightUrl from "../../../mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.40 (1).jpeg";

const AvailabilityPage = lazy(() => import("@/pages/AvailabilityPage").then((module) => ({ default: module.AvailabilityPage })));
const HomePage = lazy(() => import("@/pages/HomePage").then((module) => ({ default: module.HomePage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const DropdownMasterPage = lazy(() => import("@/pages/DropdownMasterPage").then((module) => ({ default: module.DropdownMasterPage })));
const FormsPage = lazy(() => import("@/pages/FormsPage").then((module) => ({ default: module.FormsPage })));
const FMSBuilderPage = lazy(() => import("@/pages/FMSBuilderPage").then((module) => ({ default: module.FMSBuilderPage })));
const FMSTasksPage = lazy(() => import("@/pages/FMSTasksPage").then((module) => ({ default: module.FMSTasksPage })));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const CRMPage = lazy(() => import("@/pages/CRMPage").then((module) => ({ default: module.CRMPage })));
const TasksPage = lazy(() => import("@/pages/TasksPage").then((module) => ({ default: module.TasksPage })));
const UserManagementPage = lazy(() => import("@/pages/UserManagementPage").then((module) => ({ default: module.UserManagementPage })));
const ReportsPage = lazy(() => import("@/pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

const PAGE_ICONS: Record<PageId, typeof Home> = {
  home: Home,
  dashboard: LayoutDashboard,
  crm: Users,
  checklist_tasks: CheckSquare,
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
  "delegation_tasks",
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

const APP_DESCRIPTIONS: Partial<Record<PageId, string>> = {
  home: "See today's authorized work, linked forms, FMS stages, and activity.",
  dashboard: "Review truthful operational analytics and transparent formulas.",
  crm: "Manage clients, walk-ins, interactions, follow-ups, and documents.",
  fms_tasks: "Run assigned stages and authorized workflows.",
  fms_builder: "Design and publish versioned process flows.",
  users: "Manage authorized employee accounts.",
  availability: "Record real working availability.",
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      setError(await signIn(email.trim(), password));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-obsidian px-5 py-10">
      <section className="glass-card w-full max-w-md rounded-2xl p-7 sm:p-9">
        <img alt="MK Jewels" className="mx-auto mb-8 h-14 w-auto object-contain" src={logoDarkUrl} />
        <p className="mb-6 text-center text-sm text-soft-grey">Sign in to JewelOS</p>
        {statusMessage ? <div className="mb-5"><Notice tone="danger">{statusMessage}</Notice></div> : null}
        {error ? <div className="mb-5"><Notice tone="danger">{error}</Notice></div> : null}
        <form className="space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="label">Email</span>
            <input
              autoComplete="email"
              className="field"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
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
        </form>
      </section>
    </main>
  );
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
  const { navigate, path } = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [appsOpen, setAppsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!profile || path !== "/" || preferences.default_landing_page !== "dashboard") return;
    const key = `jewelos-default-landing-${profile.id}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "applied");
    navigate("/dashboard");
  }, [navigate, path, preferences.default_landing_page, profile]);
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
    label: item.id === "checklist_tasks" ? "My Tasks" : item.id === "delegation_tasks" ? "Delegated" : item.label,
  })), [menu]);
  const launcherItems = useMemo<LauncherItem[]>(() => nav.flatMap((item) => {
    const description = APP_DESCRIPTIONS[item.id];
    return description ? [{ ...item, description }] : [];
  }), [nav]);
  if (!profile) return null;
  const requestedPage = getPageForPath(path) ?? "home";
  const allowed = IMPLEMENTED_PAGES.has(requestedPage) && canAccessPage(profile.user_role, requestedPage);
  const currentPage: PageId = allowed ? requestedPage : "dashboard";
  const pageContent = currentPage === "home" ? <HomePage onNavigate={navigate} />
    : currentPage === "dashboard" ? <DashboardPage />
    : currentPage === "reports" ? <ReportsPage />
    : currentPage === "settings" ? <SettingsPage />
    : currentPage === "users" ? <UserManagementPage />
    : currentPage === "crm" ? <CRMPage />
    : currentPage === "dropdown_master" ? <DropdownMasterPage />
      : currentPage === "checklist_tasks" ? <TasksPage />
        : currentPage === "delegation_tasks" ? <TasksPage delegatedView />
      : currentPage === "availability" ? <AvailabilityPage />
          : currentPage === "forms_library" ? <FormsPage />
            : currentPage === "fms_tasks" ? <FMSTasksPage />
              : currentPage === "fms_builder" ? <FMSBuilderPage />
                : currentPage === "notifications" ? <NotificationsPage onNavigate={navigate} />
            : <DashboardPage />;

  return (
    <ApplicationShell
      appsOpen={appsOpen}
      branch={branch}
      currentPage={currentPage}
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
    >
      <LazyPageErrorBoundary onNavigate={navigate}><Suspense fallback={<div className="flex min-h-48 items-center justify-center text-gold">Loading…</div>}>{pageContent}</Suspense></LazyPageErrorBoundary>
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
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
