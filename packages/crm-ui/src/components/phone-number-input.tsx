"use client";

import { COUNTRY_CODES } from "@/lib/phone";

// Country code (mandatory, India first) + number. The caller keeps both values and saves
// composePhone(countryCode, number); see lib/phone.ts.
export function PhoneNumberInput({ label, ariaLabel, countryLabel = "Country code *", countryCode, number, onCountryCodeChange, onNumberChange, onBlur, placeholder, inputClassName = "mt-1 w-full rounded border border-stone-300 bg-white p-2" }: {
  label: string;
  ariaLabel?: string;
  countryLabel?: string;
  countryCode: string;
  number: string;
  onCountryCodeChange: (code: string) => void;
  onNumberChange: (number: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  inputClassName?: string;
}) {
  const known = COUNTRY_CODES.some(({ code }) => code === countryCode);
  return <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
    <label className="block text-sm"><span>{countryLabel}</span><select aria-label="Country code" required className={inputClassName} value={known ? countryCode : ""} onChange={(event) => onCountryCodeChange(event.target.value)}>{known ? null : <option value="" disabled>Choose</option>}{COUNTRY_CODES.map(({ code, country }) => <option value={code} key={code}>+{code} {country}</option>)}</select></label>
    <label className="block text-sm"><span>{label}</span><input aria-label={ariaLabel ?? label} className={inputClassName} inputMode="tel" autoComplete="tel-national" value={number} placeholder={placeholder} onChange={(event) => onNumberChange(event.target.value)} onBlur={onBlur} /></label>
  </div>;
}
