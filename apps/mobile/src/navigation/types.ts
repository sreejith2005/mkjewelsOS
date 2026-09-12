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
  /**
   * `taskType` decides the `linked_module` the submission is filed under, which
   * `submit_form_with_audit` checks against the task's own type. It is optional
   * only so an older deep link cannot crash; the screen loads the task's real
   * type when it is absent.
   */
  TaskForm: { taskId: string; formTemplateId: string; taskType?: string | null };
  FmsInstance: { instanceId: string };
  FmsStage: { instanceId: string; instanceStageId: string };
  FmsStageForm: { instanceId: string; instanceStageId: string; formTemplateId: string };
  FormFill: { formTemplateId: string; starterAssignmentId?: string };
  FormSubmission: { submissionId: string };
  ClientDetail: { clientId: string };
  Walkin: { clientId?: string };
  Followups: undefined;
  AssigningLeft: undefined;
  PermissionManagement: undefined;
  FmsBuilder: { flowId: string | null; duplicate?: boolean };
  Profile: undefined;
};

export type TabParamList = {
  Home: undefined;
  Tasks: undefined;
  Fms: undefined;
  Crm: undefined;
  Section: { page: PageId };
};

/** The order tabs appear in when the viewer's role allows them. */
export const TAB_ORDER = ["Home", "Tasks", "Fms", "Crm", "Section"] as const;

/** The page each tab stands for, so role checks stay driven by `@jewelos/core`. */
export const TAB_PAGE: Readonly<Record<keyof TabParamList, PageId | null>> = {
  Home: "home",
  Tasks: "checklist_tasks",
  Fms: "fms_builder",
  Crm: "crm",
  Section: null,
};
