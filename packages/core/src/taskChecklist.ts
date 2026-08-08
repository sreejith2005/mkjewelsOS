export type TaskChecklistProgressItem = Readonly<{
  is_completed: boolean | null;
  is_required: boolean | null;
}>;

export type TaskChecklistProgress = Readonly<{
  canCompleteRequiredItems: boolean;
  completedItems: number;
  displayPercent: number;
  requiredCompletedItems: number;
  requiredItems: number;
  totalItems: number;
}>;

export function calculateTaskChecklistProgress(
  items: readonly TaskChecklistProgressItem[],
): TaskChecklistProgress {
  let completedItems = 0;
  let requiredCompletedItems = 0;
  let requiredItems = 0;

  for (const item of items) {
    if (item.is_completed === true) completedItems += 1;
    if (item.is_required === true) {
      requiredItems += 1;
      if (item.is_completed === true) requiredCompletedItems += 1;
    }
  }

  return {
    canCompleteRequiredItems: requiredCompletedItems === requiredItems,
    completedItems,
    displayPercent: items.length === 0 ? 0 : Math.round((completedItems / items.length) * 100),
    requiredCompletedItems,
    requiredItems,
    totalItems: items.length,
  };
}
