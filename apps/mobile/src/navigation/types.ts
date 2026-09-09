import type { PageId } from "@jewelos/core";

/**
 * Every route the app can reach, and what it needs to render.
 *
 * Screens are addressed by id rather than by URL: the web app's paths exist to
 * be typed into a browser, which is not a thing a phone does. `PageId` still
 * anchors both clients to the same role-permission table.
 */
export type RootStackParamList = {
  Tabs: undefined;
  TaskDetail: { taskId: string };
  TaskForm: { taskId: string; formTemplateId: string };
  FmsInstance: { instanceId: string };
  FmsStage: { instanceId: string; instanceStageId: string };
  FmsStageForm: { instanceStageId: string; formTemplateId: string };
  FormFill: { formTemplateId: string; starterAssignmentId?: string };
  FormSubmission: { submissionId: string };
  ClientDetail: { clientId: string };
  Walkin: { clientId?: string };
  Followups: undefined;
  Section: { page: PageId };
  Profile: undefined;
};

export type TabParamList = {
  Home: undefined;
  Tasks: undefined;
  Fms: undefined;
  Crm: undefined;
  More: undefined;
};

/** The order tabs appear in when the viewer's role allows them. */
export const TAB_ORDER = ["Home", "Tasks", "Fms", "Crm", "More"] as const;

/** The page each tab stands for, so role checks stay driven by `@jewelos/core`. */
export const TAB_PAGE: Readonly<Record<keyof TabParamList, PageId | null>> = {
  Home: "home",
  Tasks: "checklist_tasks",
  Fms: "fms_tasks",
  Crm: "crm",
  More: null,
};
