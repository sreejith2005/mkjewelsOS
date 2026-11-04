// Answers of the CRM question types (owner request 2026-11-03): a repeating group's rows and the
// files of a CRM photo question. Both are objects with a "kind", so they never look like a list
// of choices to the code that handles ordinary answers.
import type { FormCrmFile, FormCrmFilesAnswer, FormRepeatAnswer } from "./types.ts";
import type { ClientProfileKey } from "./clientAutofill.ts";

export function isFormRepeatAnswer(value: unknown): value is FormRepeatAnswer {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { kind?: unknown }).kind === "repeat";
}

export function isFormCrmFilesAnswer(value: unknown): value is FormCrmFilesAnswer {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { kind?: unknown }).kind === "crm_files";
}

/** How many rows a repeating group answer asks for ("NA" and blank are none). */
export function formRepeatRowCount(answer: FormRepeatAnswer): number {
  const count = Number(answer.count);
  return answer.count === "NA" || !Number.isInteger(count) || count < 0 ? 0 : count;
}

/** What a client or pincode lookup found: client details by detail key, and answers for specific questions. */
export type FormClientLookup = Readonly<{
  details?: Readonly<Partial<Record<ClientProfileKey, string | null>>> | undefined;
  /** Answers for particular questions (for example the questions a CRM form links to each detail), as people see them. */
  byQuestion?: Readonly<Record<string, string>> | undefined;
}>;

/**
 * What CRM gives a form (owner request 2026-11-04): client details for a phone number and an
 * address for a pincode in every form, for people with CRM access; and, in the forms CRM opens
 * itself, the branch's dropdown lists and uploads to CRM documents storage. Nothing is set up per
 * question. Without these, CRM photo questions say they only work in CRM forms.
 */
export type FormCrmServices = Readonly<{
  lookup: (kind: "client_phone" | "pincode", value: string) => Promise<FormClientLookup | null>;
  /** Dropdown choices CRM supplies for a question (the branch's salespeople or CRM on duty), or null. */
  choices?: ((fieldKey: string) => readonly string[] | null) | undefined;
  upload?: ((fieldKey: string, file: File, options: Readonly<{ video: boolean }>) => Promise<FormCrmFile>) | undefined;
  remove?: ((file: FormCrmFile) => Promise<void>) | undefined;
}>;

/** The stored answer for a choice question from the text a person would see (its label), or the text itself. */
export function formChoiceValueFromText(options: readonly Readonly<{ value: string; label: string }>[] | undefined, text: string): string {
  const wanted = text.trim().toUpperCase();
  return options?.find((option) => option.label.trim().toUpperCase() === wanted || option.value.trim().toUpperCase() === wanted)?.value ?? text;
}
