import { useEffect, useState, type FormEvent } from "react";
import {
  Bell,
  Bot,
  Boxes,
  Building2,
  CalendarCheck,
  CheckSquare,
  ClipboardList,
  FileText,
  Home,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  PanelLeftClose,
  Settings,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import {
  ALL_MENU_ITEMS,
  canAccessPage,
  getMenuForRole,
  getPageForPath,
  type PageId,
} from "@jewelos/core";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { initials, titleCase } from "@/lib/format";
import { UserManagementPage } from "@/pages/UserManagementPage";
import { DropdownMasterPage } from "@/pages/DropdownMasterPage";
import logoUrl from "../../../mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.41 (1).jpeg";

const PAGE_ICONS: Record<PageId, typeof Home> = {
  home: Home,
  dashboard: LayoutDashboard,
  crm: Users,
  checklist_tasks: CheckSquare,
  delegation_tasks: ClipboardList,
  fms_tasks: Boxes,
  fms_builder: Workflow,
  forms_library: FileText,
  meeting_ai: Bot,
  notifications: Bell,
  users: Users,
  availability: CalendarCheck,
  reports: Sparkles,
  dropdown_master: ListFilter,
  settings: Settings,
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
        <img alt="MK Jewels" className="mx-auto mb-8 h-14 w-auto object-contain" src={logoUrl} />
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

function ComingSoon({ page }: { page: PageId }) {
  const item = ALL_MENU_ITEMS.find((candidate) => candidate.id === page);
  return (
    <section className="glass-card rounded-2xl p-8 text-center">
      <Sparkles className="mx-auto h-9 w-9 text-gold" />
      <h1 className="mt-4 font-display text-3xl text-gold">{item?.label}</h1>
      <p className="mt-2 text-sm text-soft-grey">Coming in a later phase.</p>
    </section>
  );
}

function AppShell() {
  const { branch, logout, profile } = useAuth();
  const { navigate, path } = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const menu = profile ? getMenuForRole(profile.user_role) : [];
  const nav = menu.map((item) => ({ ...item, Icon: PAGE_ICONS[item.id] }));
  if (!profile) return null;
  const requestedPage = getPageForPath(path) ?? "home";
  const allowed = canAccessPage(profile.user_role, requestedPage);
  const currentPage = allowed ? requestedPage : "home";
  const pageContent = currentPage === "users"
    ? <UserManagementPage />
    : currentPage === "dropdown_master"
      ? <DropdownMasterPage />
      : <ComingSoon page={currentPage} />;

  return (
    <div className="min-h-screen bg-obsidian">
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center border-b border-gold/20 bg-charcoal/95 px-3 backdrop-blur sm:px-5">
        <Button
          aria-label="Toggle sidebar"
          className="mr-3 h-10 w-10 p-0"
          onClick={() => setSidebarOpen((open) => !open)}
          variant="ghost"
        >
          {sidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <img alt="MK Jewels" className="h-8 w-auto" src={logoUrl} />
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-champagne md:inline">{branch?.name ?? "Branch unavailable"}</span>
          <div className="flex items-center gap-2 rounded-lg border border-gold/20 bg-obsidian px-2 py-1.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gold font-bold text-obsidian">
              {initials(profile.employee_name)}
            </span>
            <div className="hidden sm:block">
              <p className="max-w-36 truncate text-xs font-semibold text-white">{profile.employee_name}</p>
              <p className="text-[10px] uppercase tracking-wider text-gold">{titleCase(profile.user_role)}</p>
            </div>
          </div>
          <Button aria-label="Log out" className="h-10 w-10 p-0" onClick={() => void logout()} variant="ghost">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <aside
        className={`fixed bottom-0 left-0 top-16 z-30 w-64 overflow-y-auto border-r border-gold/20 bg-charcoal p-3 transition-transform ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav className="space-y-1" aria-label="Primary navigation">
          {nav.map(({ Icon, ...item }) => (
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                currentPage === item.id ? "bg-gold text-obsidian" : "text-champagne hover:bg-gold/10 hover:text-gold"
              }`}
              key={item.id}
              onClick={() => {
                navigate(item.path);
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              type="button"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className={`pt-16 transition-[padding] ${sidebarOpen ? "md:pl-64" : "pl-0"}`}>
        <div className="mx-auto max-w-7xl p-4 sm:p-6">{pageContent}</div>
      </main>
    </div>
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
