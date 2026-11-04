// crm-port: CRM forms built in the JewelOS Form Builder (owner request 2026-11-03). The host
// (JewelOS) knows the Form Builder: it reads the active links, shows a linked form with its own
// form renderer, and owns the CRM Form Settings panel. The CRM decides what a submitted form
// means and saves it through its own audited RPCs. The host's forms open in JewelOS dialogs
// outside the CRM root, because the CRM stylesheet resets every element inside it.
import { createContext, useContext, type ReactNode } from "react";
import type { CrmFieldMap, CrmFormPurpose, CrmFormTarget, CrmLeadFieldWithId, CrmLeadOptionRoute, FormAnswers, FormCrmServices, FormTemplateDefinition } from "@jewelos/core";

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

export const CrmFormsHostContext = createContext<CrmFormsHost | null>(null);

export function useCrmFormsHost(): CrmFormsHost | null {
  return useContext(CrmFormsHostContext);
}
