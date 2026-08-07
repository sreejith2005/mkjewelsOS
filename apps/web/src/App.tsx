import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Building2,
  CalendarCheck,
  CheckSquare,
  ClipboardList,
  Home,
  LayoutDashboard,
  ListFilter,
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
import type { LauncherItem } from "@/components/shell/AppLauncher";
import logoDarkUrl from "../../../mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.41 (1).jpeg";
import logoLightUrl from "../../../mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.40 (1).jpeg";

const AvailabilityPage = lazy(() => import("@/pages/AvailabilityPage").then((module) => ({ default: module.AvailabilityPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const DropdownMasterPage = lazy(() => import("@/pages/DropdownMasterPage").then((module) => ({ default: module.DropdownMasterPage })));
const TasksPage = lazy(() => import("@/pages/TasksPage").then((module) => ({ default: module.TasksPage })));
const UserManagementPage = lazy(() => import("@/pages/UserManagementPage").then((module) => ({ default: module.UserManagementPage })));

const PAGE_ICONS: Record<PageId, typeof Home> = {
  home: Home,
  dashboard: LayoutDashboard,
  crm: Users,
  checklist_tasks: CheckSquare,
  delegation_tasks: ClipboardList,
  fms_tasks: ClipboardList,
  fms_builder: ClipboardList,
  forms_library: ClipboardList,
  meeting_ai: ClipboardList,
  notifications: ClipboardList,
  users: Users,
  availability: CalendarCheck,
  reports: ClipboardList,
  dropdown_master: ListFilter,
  settings: ClipboardList,
};

const IMPLEMENTED_PAGES = new Set<PageId>([
  "dashboard",
  "checklist_tasks",
  "delegation_tasks",
  "users",
  "availability",
  "dropdown_master",
]);

const APP_DESCRIPTIONS: Partial<Record<PageId, string>> = {
  users: "Manage authorized employee accounts.",
  availability: "Record real working availability.",
  dropdown_master: "Maintain active master values.",
};

function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (nextPath: string) => {
    if (nextPath !== window.location.pathname) window.history.pushState({}, "", nextPath);
    setPath(nextPath);
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
  const { branch, logout, profile } = useAuth();
  const { navigate, path } = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [appsOpen, setAppsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
  const pageContent = currentPage === "users" ? <UserManagementPage />
    : currentPage === "dropdown_master" ? <DropdownMasterPage />
      : currentPage === "checklist_tasks" ? <TasksPage />
        : currentPage === "delegation_tasks" ? <TasksPage delegatedView />
          : currentPage === "availability" ? <AvailabilityPage />
            : <DashboardPage items={launcherItems} onNavigate={navigate} />;

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
      path={currentPage === "dashboard" ? "/dashboard" : path}
      profile={profile}
      setSidebarOpen={setSidebarOpen}
      sidebarOpen={sidebarOpen}
    >
      <Suspense fallback={<div className="flex min-h-48 items-center justify-center text-gold">Loading…</div>}>{pageContent}</Suspense>
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
