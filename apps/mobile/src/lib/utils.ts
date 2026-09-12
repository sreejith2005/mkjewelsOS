import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Identical to `apps/web/src/lib/utils.ts`.
 *
 * It is duplicated rather than shared because it is six lines with no business
 * meaning, and sharing it would put a dependency on `tailwind-merge` into a
 * package that has no other reason to care about CSS. Keeping the signature the
 * same is what matters: a web component's `cn(...)` call can be copied here
 * unchanged.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
