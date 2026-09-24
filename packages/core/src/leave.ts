export type LeaveHalf = "FULL DAY" | "1ST HALF" | "2ND HALF";
export type ReturnHalf = "1ST HALF" | "2ND HALF";

function dayNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a valid date");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Enter a valid date");
  return Math.floor(date.getTime() / 86_400_000);
}

export function validateLeaveDates(start: string, end: string, workStart: string): void {
  const first = dayNumber(start);
  const last = dayNumber(end);
  const returnDay = dayNumber(workStart);
  if (last < first) throw new Error("Leave end cannot be before leave start");
  if (returnDay < last) throw new Error("Work start cannot be before leave end");
  if (returnDay - first > 366) throw new Error("Leave range cannot exceed 367 days");
}

export function leaveInformStatus(submittedDate: string, start: string, end: string): "Inform Adv" | "Not inform In Adv" {
  const submitted = dayNumber(submittedDate);
  const first = dayNumber(start);
  const last = dayNumber(end);
  const gap = last - first;
  if ((gap >= 7 && first - submitted >= 20)
    || (gap >= 3 && gap <= 6 && last - submitted >= 7)
    || (gap <= 2 && first - submitted >= 3)) return "Inform Adv";
  return "Not inform In Adv";
}

/** Mirrors the source sheet's counting rules, including its long second-half adjustment. */
export function countLeaveDays(duration: LeaveHalf, start: string, end: string, workStart: string, workHalf: ReturnHalf): number {
  validateLeaveDates(start, end, workStart);
  const first = dayNumber(start);
  const returnDay = dayNumber(workStart);
  if (first === returnDay) {
    if (workHalf === "1ST HALF") return 0;
    return duration === "2ND HALF" ? 0 : 0.5;
  }
  let total = 0;
  for (let day = first; day < returnDay; day += 1) {
    if (new Date(day * 86_400_000).getUTCDay() === 0) continue;
    total += day === first && duration === "2ND HALF" ? 0.5 : 1;
  }
  if (workHalf === "2ND HALF" && new Date(returnDay * 86_400_000).getUTCDay() !== 0) total += 0.5;
  if (duration === "2ND HALF" && workHalf === "2ND HALF" && returnDay - first >= 5) total += 0.5;
  return total;
}
