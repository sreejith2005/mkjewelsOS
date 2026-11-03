// The CRM forms host CrmApp receives in the JewelOS shell (CRM Form Settings, 2026-11-03).
// The dialogs and the form renderer load only when CRM first needs them, so the first page
// load stays as small as before.
import { lazy, Suspense } from "react";
import type { CrmFormsHost } from "@jewelos/crm-ui";

const LinkedFormDialog = lazy(() => import("./crmForms").then((module) => ({ default: module.LinkedFormDialog })));
const CrmFormSettingsDialog = lazy(() => import("./crmForms").then((module) => ({ default: module.CrmFormSettingsDialog })));

export function createCrmFormsHost(navigate: (href: string) => void): CrmFormsHost {
  return {
    loadLinks: () => import("./crmForms").then((module) => module.loadCrmFormLinks()),
    renderForm: (props) => <Suspense fallback={null}><LinkedFormDialog {...props} /></Suspense>,
    renderSettings: ({ links, targets, leadSetup, onClose, onSaved }) => <Suspense fallback={null}><CrmFormSettingsDialog leadSetup={leadSetup} links={links} onClose={onClose} onEditForm={(familyId) => { onClose(); navigate(`/forms?editForm=${encodeURIComponent(familyId)}`); }} onSaved={onSaved} targets={targets} /></Suspense>,
  };
}
