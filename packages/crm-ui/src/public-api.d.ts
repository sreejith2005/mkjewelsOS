// Type surface of @jewelos/crm-ui for its consumers (the web app). The ported original CRM
// sources are checked with their own compiler settings in this package; consumers read only
// this declaration. tests/public-api.test.ts keeps it identical to src/index.ts.
import type { ReactElement, ReactNode } from "react";
import type { CrmFieldMap, CrmFormPurpose, CrmFormTarget, CrmLeadFieldWithId, CrmLeadOptionRoute, FormAnswers, FormCrmServices, FormTemplateDefinition } from "@jewelos/core";
import type { JewelosClient } from "@jewelos/api-client";

export type CrmAppProps = {
  /** The signed-in JewelOS browser client: the identity only. CRM data is read from the CRM project. */
  supabase: JewelosClient;
  /** The CRM Supabase project's public URL and anon key (two-project design, 2026-10-01). */
  crmProject: CrmProjectConfig;
  /**
   * Embedded mode only: the native app's current JewelOS access token, which the login bridge
   * exchanges for a CRM token. In the browser the JewelOS client's own session is used.
   */
  jewelosAccessToken?: (() => Promise<string | null>) | undefined;
  /** Current JewelOS browser pathname, e.g. "/crm/queue". */
  path: string;
  /** Current location.search, e.g. "?branch=...". */
  search: string;
  /** JewelOS history navigation to an absolute path. */
  navigate: (href: string) => void;
  /** JewelOS sign-out (the original CRM sign-out server action). */
  onSignOut: () => Promise<void> | void;
  /** Where "← JewelOS" returns to. */
  jewelosHomePath: string;
  /**
   * Embedded mode only (the JewelOS Android app's WebView): stands in for supabase.auth, which
   * a client fed by the native access token does not have.
   */
  auth?: CrmAuth | undefined;
  /** The JewelOS theme; with onThemeChange it shows the light/dark switch in the CRM header. */
  theme?: "light" | "dark" | undefined;
  onThemeChange?: ((theme: "light" | "dark") => void) | undefined;
  /**
   * "section": rendered inside the JewelOS application shell, which keeps its header, sidebar
   * and theme switch; the CRM shows only its section tabs. Default "standalone": the original
   * CRM header and drawer.
   */
  layout?: "standalone" | "section" | undefined;
  /** JewelOS Form Builder forms linked to CRM registration (CRM Form Settings). Absent: the standard CRM forms. */
  forms?: CrmFormsHost | undefined;
};

/** The published version of a linked form, as CRM opens it now. */
export type CrmLinkedForm = Readonly<{ templateId: string; familyId: string; version: number; name: string; definition: FormTemplateDefinition }>;

export type CrmFormLink = Readonly<{
  purpose: CrmFormPurpose;
  versionId: string;
  fieldMap: CrmFieldMap;
  savedAt: string;
  savedBy: string | null;
  /** Null when the form has no published version any more. */
  form: CrmLinkedForm | null;
}>;

export type CrmFormLinks = Readonly<{ canManage: boolean; links: readonly CrmFormLink[] }>;

/** The CRM lead form as configured today (fields, answer routes, dropdown choices), for an exact Form Builder copy. */
export type CrmLeadSetup = Readonly<{ fields: readonly CrmLeadFieldWithId[]; routes: readonly CrmLeadOptionRoute[]; lookupOptions: Readonly<Record<string, readonly string[]>> }>;

/** A submitted form: the stored answers, and each answer as the person saw it (a choice's label). */
export type CrmSubmittedForm = Readonly<{ answers: FormAnswers; display: Readonly<Record<string, string>>; rowDisplay?: Readonly<Record<string, readonly Readonly<Record<string, string>>[]>> | undefined }>;

export type CrmFormsHost = Readonly<{
  loadLinks: () => Promise<CrmFormLinks>;
  /** Opens a linked form in a JewelOS dialog. onSubmit throws an Error whose message the form shows. */
  renderForm: (props: {
    title: string; description?: string | undefined; form: CrmLinkedForm; onClose: () => void; onSubmit: (submitted: CrmSubmittedForm) => Promise<void>;
    /** Answers to start with, keyed by question key, as people see them (choice labels). */
    initialText?: Readonly<Record<string, string>> | undefined;
    /** CRM lookups, branch lists and CRM uploads for CRM questions. */
    crm?: FormCrmServices | undefined;
    submitLabel?: string | undefined;
  }) => ReactNode;
  /** The CRM Form Settings dialog (people allowed to manage CRM forms). */
  renderSettings: (props: { links: CrmFormLinks; targets: Readonly<Record<"queue" | "lead" | "walkin", readonly CrmFormTarget[]>>; leadSetup: CrmLeadSetup; onClose: () => void; onSaved: () => void }) => ReactNode;
}>;

/** The CRM Supabase project the CRM reads and writes (public URL and anon key). */
export type CrmProjectConfig = Readonly<{ url: string; anonKey: string }>;

/** The part of supabase.auth the ported CRM uses. */
export type CrmAuth = {
  getUser: () => Promise<{ data: { user: { id: string; email?: string | undefined } | null }; error: unknown }>;
};

export declare function CrmApp(props: CrmAppProps): ReactElement;

export declare const CRM_BASE_PATH: "/crm";
