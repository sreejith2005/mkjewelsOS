import { Gem, Menu, X, Bell, ChevronDown, Check, Building2 } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { getMenuForRole, getBottomNavForRole, ROLE_LABELS } from "../lib/roleConfig.jsx";
import { BRANCHES, USERS } from "../data/org.js";
import { Chip, Sheet } from "./ui.jsx";

/* The three-line layout: top bar, scrolling content, bottom nav.
   Plus the drawer and the branch picker that hang off it. */

export function TopBar({ onMenu, onBranch, unread, activeBranch, onBell }) {
  return (
    <header className="shrink-0 bg-slate-900 px-4 h-14 flex items-center gap-2 z-30">
      <button onClick={onMenu} aria-label="Open menu"
        className="w-9 h-9 rounded-lg hover:bg-slate-800 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-amber-500">
        <Menu className="w-5 h-5 text-slate-300" />
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <Gem className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="text-white font-semibold text-sm tracking-tight">JewelOS</span>
      </div>
      <button onClick={onBranch}
        className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium max-w-[8rem] focus-visible:ring-2 focus-visible:ring-amber-500">
        <span className="truncate">{BRANCHES.find((b) => b.id === activeBranch)?.code}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>
      <button onClick={onBell} aria-label={`Alerts, ${unread} unread`}
        className="relative w-9 h-9 rounded-lg hover:bg-slate-800 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-amber-500">
        <Bell className="w-5 h-5 text-slate-300" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
    </header>
  );
}

export function BottomNav({ page, go, profile, unread }) {
  const items = getBottomNavForRole(profile);
  return (
    <nav className="shrink-0 bg-white border-t border-slate-200 grid z-30"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
      {items.map((m) => {
        const on = page === m.page;
        return (
          <button key={m.page} onClick={() => go(m.page)}
            className="py-2.5 flex flex-col items-center gap-1 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-inset">
            <span className="relative">
              <m.icon className={`w-5 h-5 ${on ? "text-slate-900" : "text-slate-400"}`} />
              {m.page === "Notifications" && unread > 0 && (
                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-rose-500" />
              )}
            </span>
            <span className={`text-[10px] leading-none ${on ? "text-slate-900 font-semibold" : "text-slate-400"}`}>
              {m.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function Drawer({ open, onClose, page, go, unread, onSwitchProfile, profileId }) {
  const { profile } = useStore();
  if (!open) return null;

  const menu = getMenuForRole(profile);
  const role = ROLE_LABELS[profile.role_level];

  return (
    <div className="absolute inset-0 z-50 flex">
      <button aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-slate-900/50" />
      <div className="relative w-72 bg-white h-full flex flex-col animate-jos-drawer">
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-5 pt-5 pb-6">
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <Gem className="w-5 h-5 text-white" />
            </div>
            <button onClick={onClose} aria-label="Close"
              className="w-8 h-8 rounded-lg hover:bg-slate-800 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-amber-500">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          <p className="text-white font-semibold mt-3">{profile.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{profile.designation}</p>
          <Chip className={`${role.chip} mt-2.5`}>{role.label}</Chip>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {menu.map((m) => {
            const on = page === m.page;
            return (
              <button key={m.page} onClick={() => go(m.page)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-inset ${on ? "bg-slate-50" : ""}`}>
                <m.icon className={`w-[18px] h-[18px] shrink-0 ${on ? "text-slate-900" : "text-slate-400"}`} />
                <span className={`text-sm ${on ? "text-slate-900 font-semibold" : "text-slate-600"}`}>{m.label}</span>
                {m.page === "Notifications" && unread > 0 && (
                  <span className="ml-auto text-[10px] font-semibold text-white bg-rose-500 rounded-full px-1.5 py-0.5">{unread}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="border-t border-slate-100 p-4">
          <p className="text-xs font-semibold text-slate-900 mb-1">View the app as</p>
          <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
            Menu, tabs and page access all change with the role.
          </p>
          <div className="space-y-1">
            {USERS.filter((u) => u.working_status === "active").slice(0, 6).map((u) => (
              <button key={u.id} onClick={() => onSwitchProfile(u)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left focus-visible:ring-2 focus-visible:ring-amber-500 ${u.id === profileId ? "bg-slate-100" : ""}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${ROLE_LABELS[u.role_level].dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-slate-800 truncate">{u.name}</span>
                  <span className="block text-[10px] text-slate-400 truncate">{ROLE_LABELS[u.role_level].label}</span>
                </span>
                {u.id === profileId && <Check className="w-3.5 h-3.5 text-slate-900 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BranchPicker({ open, onClose, activeBranch, onPick, profile }) {
  return (
    <Sheet open={open} title="Switch branch" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        You can only see branches your profile has access to.
      </p>
      <div className="space-y-1.5">
        {BRANCHES.map((b) => {
          const can = profile.accessible_branches.includes(b.id);
          return (
            <button key={b.id} disabled={!can} onClick={() => onPick(b)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-amber-500 ${
                activeBranch === b.id ? "border-slate-900 bg-slate-50" : "border-slate-200"
              }`}>
              <span className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4 text-slate-600" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-900 truncate">{b.name}</span>
                <span className="block text-xs text-slate-500 capitalize">{b.type} &middot; {b.city}</span>
              </span>
              {!can && <span className="text-xs text-slate-400 shrink-0">No access</span>}
              {activeBranch === b.id && <Check className="w-4 h-4 text-slate-900 shrink-0" />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
