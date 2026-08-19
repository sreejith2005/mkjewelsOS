import { useState, useMemo, useCallback } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";

import { Store } from "./lib/store.jsx";
import { ALL_MENU_ITEMS, PATH_OF, PAGE_OF, canAccessPage } from "./lib/roleConfig.jsx";
import { USERS, BRANCHES, branchOf } from "./data/org.js";
import { CUSTOMERS, INTERACTIONS } from "./data/crm.js";
import { seedInstances, seedNotifications } from "./data/tasks.js";
import { seedFmsInstances, FMS_FLOWS, resolveAssignee } from "./data/fms.js";
import { seedSubmissions } from "./data/forms.js";
import { uid, TODAY_ISO } from "./lib/utils.js";

import { TopBar, BottomNav, Drawer, BranchPicker } from "./components/Shell.jsx";
import { Toast } from "./components/ui.jsx";
import DelegateSheet from "./components/DelegateSheet.jsx";
import AccessDenied from "./components/AccessDenied.jsx";

import Home from "./pages/Home.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import CRM from "./pages/CRM.jsx";
import MyTasks from "./pages/MyTasks.jsx";
import FMSBuilder from "./pages/FMSBuilder.jsx";
import Forms from "./pages/Forms.jsx";
import Notifications from "./pages/Notifications.jsx";
import UserManagement from "./pages/UserManagement.jsx";
import DropdownManager from "./pages/DropdownManager.jsx";
import Settings from "./pages/Settings.jsx";

const PAGE_COMPONENT = {
  Home, Dashboard, CRM, MyTasks, FMSBuilder, Forms,
  Notifications, UserManagement, DropdownManager, Settings,
};

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  /* ---------- session ---------- */
  const [profileId, setProfileId] = useState("u4");
  const [activeBranch, setActiveBranch] = useState("b1");
  const [drawer, setDrawer] = useState(false);
  const [branchPick, setBranchPick] = useState(false);
  const [msg, setMsg] = useState("");
  const [delegateFor, setDelegateFor] = useState(null);

  /* ---------- data ---------- */
  const [tasks, setTasks] = useState(seedInstances);
  const [interactions, setInteractions] = useState(INTERACTIONS);
  const [notifications, setNotifications] = useState(seedNotifications);
  const [fmsInstances, setFmsInstances] = useState(seedFmsInstances);
  const [submissions, setSubmissions] = useState(seedSubmissions);

  const rawProfile = USERS.find((u) => u.id === profileId);
  // Platform owner bypass: super_admin gets a wildcard permission set.
  const profile = useMemo(
    () => (rawProfile.role_level === "super_admin" ? { ...rawProfile, permissions: ["*"] } : rawProfile),
    [rawProfile]
  );

  const toast = useCallback((m) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2200);
  }, []);

  const go = useCallback((page) => {
    navigate(PATH_OF[page] || "/");
    setDrawer(false);
  }, [navigate]);

  /* ================= mutations =================
     Each one is a single place to swap in a real API call. */

  // API: PATCH /task-instances/:id  { checklist }
  const toggleChecklist = (taskId, itemId) =>
    setTasks((prev) => prev.map((t) =>
      t.id !== taskId ? t : { ...t, checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)) }
    ));

  // API: PATCH /task-instances/:id  { status, completed_at, completed_by }
  const completeTask = (taskId) => {
    setTasks((prev) => prev.map((t) =>
      t.id !== taskId ? t : { ...t, status: "completed", sla_breached: false, checklist: t.checklist.map((c) => ({ ...c, done: true })) }
    ));
    toast("Task marked complete");
  };

  // API: POST /task-delegations + PATCH /task-instances/:id
  const delegateTask = (taskId, toUser, reason) => {
    setTasks((prev) => prev.map((t) =>
      t.id !== taskId ? t : { ...t, assigned_to: toUser, is_delegated: true, delegated_from: profile.id }
    ));
    setNotifications((prev) => [{
      id: uid("n"), user_id: toUser, type: "task",
      title: `${profile.name.split(" ")[0]} delegated a task to you`,
      message: reason || "No reason given.",
      is_read: false, priority: "medium", page: "MyTasks", when: "Just now",
    }, ...prev]);
    setDelegateFor(null);
    toast("Task delegated");
  };

  // API: POST /customer-interactions
  const addInteraction = (payload) => {
    setInteractions((prev) => [{ id: uid("i"), user_id: profile.id, date: TODAY_ISO, ...payload }, ...prev]);
    toast("Interaction logged");
  };

  // API: PATCH /notifications/:id { is_read }
  const markRead = (id) => setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    toast("All alerts read");
  };

  // API: POST /form-submissions
  const submitForm = (formId, display) => {
    setSubmissions((prev) => [...prev, {
      id: uid("sb"), form_template_id: formId, submitted_by: profile.id,
      submitted_on: TODAY_ISO, status: "pending", data_display: display,
    }]);
    toast("Form sent for review");
  };

  // API: PATCH /form-submissions/:id { status, review_notes }
  const reviewSubmission = (id, status) => {
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    toast(status === "approved" ? "Submission approved" : "Sent back with notes");
  };

  // API: POST /fms-instances
  const startInstance = (flow, payload) => {
    const prefix = { sales: "CO", service: "RP", inventory: "ST", procurement: "VN" }[flow.category] || "WF";
    const ref = `${prefix}-2026-${String(Math.floor(Math.random() * 900) + 100)}`;
    const step_states = flow.steps.map((s, i) => ({
      step_id: s.id,
      status: i === 0 ? "in_progress" : "pending",
      assigned_to: resolveAssignee(s, profile),
      completed_on: null,
    }));
    setFmsInstances((prev) => [{
      id: uid("fi"), flow_id: flow.id, title: payload.title, status: "active",
      priority: payload.priority, reference_number: ref, started_by: profile.id,
      started_on: TODAY_ISO, context: {}, current_step_ids: [flow.steps[0].id],
      sla_breached: false, step_states,
    }, ...prev]);
    toast(`Started ${ref}`);
  };

  // API: PATCH /fms-instances/:id { step_states, current_step_ids, status }
  const advanceStep = (instId, stepId) => {
    setFmsInstances((prev) => prev.map((inst) => {
      if (inst.id !== instId) return inst;
      const flow = FMS_FLOWS.find((f) => f.id === inst.flow_id);
      const idx = inst.step_states.findIndex((s) => s.step_id === stepId);
      const states = inst.step_states.map((s, i) =>
        i === idx ? { ...s, status: "completed", completed_on: TODAY_ISO } : s
      );

      // Branch steps resolve automatically; skip past the arm that wasn't taken.
      let next = idx + 1;
      while (next < states.length && flow.steps.find((s) => s.id === states[next].step_id)?.type === "branch") {
        states[next] = { ...states[next], status: "completed", completed_on: TODAY_ISO, note: "Routed automatically" };
        next += 1;
      }

      if (next < states.length) {
        states[next] = { ...states[next], status: "in_progress" };
        return { ...inst, step_states: states, current_step_ids: [states[next].step_id], sla_breached: false };
      }
      return { ...inst, step_states: states, current_step_ids: [], status: "completed", sla_breached: false };
    }));
    toast("Step completed, moved on");
  };

  const store = {
    profile, users: USERS, customers: CUSTOMERS,
    tasks, interactions, notifications, fmsInstances, submissions,
    activeBranch, branchOf, go, toast,
    toggleChecklist, completeTask, delegateTask, addInteraction,
    markRead, markAllRead, submitForm, reviewSubmission, startInstance, advanceStep,
    delegateFor, openDelegate: setDelegateFor, closeDelegate: () => setDelegateFor(null),
  };

  const currentPage = PAGE_OF[location.pathname] || "Home";
  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <Store.Provider value={store}>
      <div className="relative flex flex-col h-[100dvh] max-w-[480px] mx-auto bg-slate-50 overflow-hidden shadow-2xl">
        <TopBar
          onMenu={() => setDrawer(true)}
          onBranch={() => setBranchPick(true)}
          onBell={() => go("Notifications")}
          unread={unread}
          activeBranch={activeBranch}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Routes>
            {ALL_MENU_ITEMS.map((m) => {
              const Page = PAGE_COMPONENT[m.page];
              return (
                <Route
                  key={m.page}
                  path={m.path}
                  element={
                    canAccessPage(m.page, profile)
                      ? <Page />
                      : <AccessDenied page={m.label} onHome={() => go("Home")} />
                  }
                />
              );
            })}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <BottomNav page={currentPage} go={go} profile={profile} unread={unread} />

        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          page={currentPage}
          go={go}
          unread={unread}
          profileId={profileId}
          onSwitchProfile={(u) => {
            setProfileId(u.id);
            setActiveBranch(u.branch_id);
            setDrawer(false);
            navigate("/");
          }}
        />

        <BranchPicker
          open={branchPick}
          onClose={() => setBranchPick(false)}
          activeBranch={activeBranch}
          profile={profile}
          onPick={(b) => {
            setActiveBranch(b.id);
            setBranchPick(false);
            toast(`Now viewing ${b.name}`);
          }}
        />

        <DelegateSheet />
        <Toast msg={msg} />
      </div>
    </Store.Provider>
  );
}
