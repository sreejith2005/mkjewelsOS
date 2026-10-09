import { IMPLEMENTED_PAGE_IDS, type PageId } from "../roleMenu.ts";
import type { SectionControls } from "../settings/sectionAvailability.ts";
import { hasPermission, resolvePageAccess, type AccessContext } from "../permissions/resolve.ts";
import type { PermissionKey } from "../permissions/catalog.ts";

/**
 * The Ask Kiara tool catalogue (spec section 8).
 *
 * Every tool is read-only and runs as the caller: the Edge Function executes it
 * with the caller's JWT, so RLS and the section RPCs decide what comes back. The
 * offering rule below only keeps the model from reaching for a tool the caller
 * could never use; the database re-checks everything.
 *
 * Order matters for prompt caching: tools render before the system prompt, so
 * the offered list must be byte-identical for every caller with the same
 * permission shape. Offering filters this fixed array and never reorders it.
 */

export type KiaraDataCategory = "tasks" | "app_help";

/** A JSON-Schema object the Messages API accepts with `strict: true`. */
export type KiaraInputSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  required: readonly string[];
  additionalProperties: false;
}>;

/** Structurally the Messages API custom-tool shape; the Edge Function passes it as is. */
export type KiaraToolDefinition = Readonly<{
  name: KiaraToolName;
  description: string;
  input_schema: KiaraInputSchema;
  strict: true;
}>;

export type KiaraToolSpec = Readonly<{
  definition: KiaraToolDefinition;
  /** Offered only when every listed permission is effective for the caller. */
  permissions: readonly PermissionKey[];
  /** Offered only when the caller may open each of these sections right now. */
  pages: readonly PageId[];
  dataCategory: KiaraDataCategory;
  /** Shown to the user while the tool runs. A fixed string, never data. */
  statusLabel: string;
}>;

export const KIARA_TOOL_NAMES = ["get_my_work_summary", "get_app_help"] as const;
export type KiaraToolName = (typeof KIARA_TOOL_NAMES)[number];

/** Sections app help can describe: every implemented page, in catalogue order. */
export const KIARA_HELP_SECTIONS: readonly PageId[] = IMPLEMENTED_PAGE_IDS;

/** Free-text input limits, enforced by the executor (strict schemas carry no lengths). */
export const KIARA_HELP_QUESTION_MAX = 200;

export const KIARA_TOOLS: readonly KiaraToolSpec[] = [
  {
    definition: {
      name: "get_my_work_summary",
      description:
        "The signed-in employee's own open work, the same lists their JewelOS Home screen shows: open and overdue tasks assigned to them (the 10 most urgent), FMS stages assigned to them (up to 6), forms they still have to fill for their tasks (up to 6), FMS starter forms waiting for them, their unread notification count, and their availability today. Use it for questions such as \"what is pending for me today\", \"my overdue tasks\", or \"aaj mera kya pending hai\". It covers only the asker's own work, never a team's.",
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      strict: true,
    },
    permissions: ["home.view"],
    pages: ["home"],
    dataCategory: "tasks",
    statusLabel: "Checking your work",
  },
  {
    definition: {
      name: "get_app_help",
      description:
        "How to use a JewelOS section: where things are and the steps for common jobs (for example applying for leave, filling a form, or creating a task). Pass the section the question is about and the question in English (at most 200 characters). Help is returned only for sections the user can open; otherwise the result says access is denied.",
      input_schema: {
        type: "object",
        properties: {
          section: { type: "string", enum: [...KIARA_HELP_SECTIONS], description: "The JewelOS section id the question is about." },
          question: { type: "string", description: "The user's how-to question in English, at most 200 characters." },
        },
        required: ["section", "question"],
        additionalProperties: false,
      },
      strict: true,
    },
    permissions: ["assistant.view"],
    pages: ["ask_kiara"],
    dataCategory: "app_help",
    statusLabel: "Looking up app help",
  },
];

const TOOL_BY_NAME = new Map<string, KiaraToolSpec>(KIARA_TOOLS.map((tool) => [tool.definition.name, tool]));

export function getKiaraTool(name: string): KiaraToolSpec | undefined {
  return TOOL_BY_NAME.get(name);
}

/** Sections the caller may open right now: permission, then feature availability. */
export function accessibleKiaraSections(access: AccessContext, controls: SectionControls): readonly PageId[] {
  return KIARA_HELP_SECTIONS.filter((page) => resolvePageAccess(access, controls, page) === "allowed");
}

/**
 * The tools offered to this caller, in catalogue order. Nothing is offered when
 * Ask Kiara itself is unavailable to them.
 */
export function offeredKiaraTools(access: AccessContext, controls: SectionControls): readonly KiaraToolSpec[] {
  if (resolvePageAccess(access, controls, "ask_kiara") !== "allowed") return [];
  return KIARA_TOOLS.filter((tool) =>
    tool.permissions.every((key) => hasPermission(access, key))
    && tool.pages.every((page) => resolvePageAccess(access, controls, page) === "allowed"));
}

export type KiaraToolInput =
  | Readonly<{ name: "get_my_work_summary" }>
  | Readonly<{ name: "get_app_help"; section: PageId; question: string }>;

export type KiaraToolInputResult =
  | Readonly<{ ok: true; input: KiaraToolInput }>
  | Readonly<{ ok: false; error: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates a model-supplied tool input against the same schema the API
 * enforces. The API's strict mode should make this a formality; it still runs
 * so a malformed input is answered with an error result, never executed.
 */
export function validateKiaraToolInput(name: string, input: unknown): KiaraToolInputResult {
  if (!isRecord(input)) return { ok: false, error: "Tool input must be an object." };
  const extra = (allowed: readonly string[]) => Object.keys(input).find((key) => !allowed.includes(key));
  if (name === "get_my_work_summary") {
    const unknown = extra([]);
    return unknown ? { ok: false, error: `Unknown field: ${unknown}` } : { ok: true, input: { name } };
  }
  if (name === "get_app_help") {
    const unknown = extra(["section", "question"]);
    if (unknown) return { ok: false, error: `Unknown field: ${unknown}` };
    const section = input.section;
    if (typeof section !== "string" || !(KIARA_HELP_SECTIONS as readonly string[]).includes(section)) {
      return { ok: false, error: "section must be one of the listed JewelOS sections." };
    }
    if (typeof input.question !== "string" || !input.question.trim()) return { ok: false, error: "question is required." };
    const question = input.question.trim().slice(0, KIARA_HELP_QUESTION_MAX);
    return { ok: true, input: { name, section: section as PageId, question } };
  }
  return { ok: false, error: `Unknown tool: ${name}` };
}
