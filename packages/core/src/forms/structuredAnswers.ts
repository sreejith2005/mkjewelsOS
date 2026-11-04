// Answers of the CRM question types (owner request 2026-11-03): a repeating group's rows and the
// files of a CRM photo question. Both are objects with a "kind", so they never look like a list
// of choices to the code that handles ordinary answers.
import type { FormCrmFile, FormCrmFilesAnswer, FormRepeatAnswer } from "./types.ts";

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

/**
 * What CRM gives a form it opens (CRM Form Settings): the branch's choice lists, lookups and
 * uploads to CRM documents storage. Outside CRM a form has none of these, and CRM-only questions
 * say so instead of collecting answers that could not be saved.
 */
export type FormCrmServices = Readonly<{
  /** The branch's CRM people on duty or salespeople, by name. */
  choices: (list: "crm_names" | "salespeople") => readonly string[];
  /** Answers to fill after a lookup, keyed by question key, as the person would see them (choice labels). Null when nothing matched. */
  lookup: (kind: "client_phone" | "pincode", value: string) => Promise<Readonly<Record<string, string>> | null>;
  upload: (fieldKey: string, file: File, options: Readonly<{ video: boolean }>) => Promise<FormCrmFile>;
  remove: (file: FormCrmFile) => Promise<void>;
}>;

/** The stored answer for a choice question from the text a person would see (its label), or the text itself. */
export function formChoiceValueFromText(options: readonly Readonly<{ value: string; label: string }>[] | undefined, text: string): string {
  const wanted = text.trim().toUpperCase();
  return options?.find((option) => option.label.trim().toUpperCase() === wanted || option.value.trim().toUpperCase() === wanted)?.value ?? text;
}
