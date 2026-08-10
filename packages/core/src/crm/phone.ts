import type { NormalizedPhone } from "./types";

const MOBILE = /^[6-9][0-9]{9}$/;

export function normalizeIndianPhone(value: string): NormalizedPhone | null {
  const display = value.trim().replace(/\s+/g, " ");
  if (!display || /[A-Za-z]/.test(display)) return null;
  let digits = display.replace(/[^0-9]/g, "");
  if (digits.startsWith("0091") && digits.length === 14) digits = digits.slice(4);
  else if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (!MOBILE.test(digits)) return null;
  return { display, normalized: `+91${digits}` };
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;
}

export function isValidIndianPincode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test(value.trim());
}
