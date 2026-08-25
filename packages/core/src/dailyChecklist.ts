export type DailyChecklistItem = Readonly<{
  id: string;
  text: string;
}>;

export type DailyChecklistDraft = Readonly<{
  title: string;
  instruction: string | null;
  confirmationText: string;
  isActive: boolean;
  items: readonly DailyChecklistItem[];
}>;

export type DailyChecklistStatus = Readonly<{
  required: boolean;
  date: string;
  checklist: Readonly<{
    id: string;
    designationId: string;
    title: string;
    instruction: string | null;
    items: readonly DailyChecklistItem[];
    confirmationText: string;
    revision: number;
  }> | null;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) throw new Error(`${label} is invalid`);
  return normalized;
}

export function validateDailyChecklistDraft(input: DailyChecklistDraft): DailyChecklistDraft {
  const title = boundedText(input.title, "checklist title", 120);
  const confirmationText = boundedText(input.confirmationText, "confirmation text", 240);
  const instruction = input.instruction?.trim() || null;
  if (instruction && instruction.length > 500) throw new Error("checklist instruction is invalid");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) {
    throw new Error("checklist must contain between 1 and 20 items");
  }
  const ids = new Set<string>();
  const items = input.items.map((item) => {
    if (!UUID_PATTERN.test(item.id)) throw new Error("checklist item ID is invalid");
    if (ids.has(item.id)) throw new Error("checklist item IDs must be unique");
    ids.add(item.id);
    return { id: item.id, text: boundedText(item.text, "checklist item text", 500) };
  });
  return { title, instruction, confirmationText, isActive: input.isActive === true, items };
}

export function calculateDailyChecklistProgress(items: readonly DailyChecklistItem[], checkedIds: ReadonlySet<string>) {
  const completedItems = items.filter((item) => checkedIds.has(item.id)).length;
  return {
    completedItems,
    totalItems: items.length,
    canAcknowledge: items.length > 0 && completedItems === items.length,
  };
}
