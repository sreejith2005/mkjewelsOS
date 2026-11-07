import { useEffect, useMemo, useState, type InputHTMLAttributes, type Ref } from "react";
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE, composePhone, formPhoneParts, phoneError, phoneKey, countryCodeOf } from "@jewelos/core";

const BY_NAME = [...COUNTRY_CODES].sort((left, right) => left.code === DEFAULT_COUNTRY_CODE ? -1 : right.code === DEFAULT_COUNTRY_CODE ? 1 : left.country.localeCompare(right.country));

/**
 * A Form Builder phone question: country code + number (MK1 audit 2026-11-07). Uses the shared
 * phone rules (@jewelos/core phone.ts, the CRM's rules): India first and 10 digits for India; a
 * number typed or pasted with "+" picks its own country. The answer is "+<code><number>".
 * An answer saved before this change is shown as it was and only rewritten when edited.
 */
export function FormPhoneInput({ value, onChange, label, disabled, inputProps, inputRef }: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean | undefined;
  /** id, aria-* and other attributes the renderer gives every answer input. */
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  inputRef?: Ref<HTMLInputElement> | undefined;
}) {
  const initial = useMemo(() => formPhoneParts(value), [value]);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  const [number, setNumber] = useState(initial.number);
  // Follow answers set from outside (a CRM client lookup, a restored draft).
  useEffect(() => {
    if (composePhone(countryCode, number) !== value && value !== number) { setCountryCode(initial.countryCode); setNumber(initial.number); }
    // Only an outside change of `value` resets the inputs; typing keeps them as typed.
  }, [value]);

  const emit = (code: string, typed: string) => onChange(typed.trim() ? composePhone(code, typed) : "");
  const changeNumber = (typed: string) => {
    // "+44 7911 123456" or "0044..." pasted or typed: take the country from the number.
    const key = typed.trim().startsWith("+") || typed.trim().startsWith("00") ? phoneKey(typed) : null;
    const detected = key ? countryCodeOf(key) : null;
    if (key && detected) {
      setCountryCode(detected); setNumber(key.slice(detected.length)); emit(detected, key.slice(detected.length));
      return;
    }
    setNumber(typed); emit(countryCode, typed);
  };
  const problem = number.trim() ? phoneError(countryCode, number) : null;
  const hintId = inputProps.id ? `${inputProps.id}-phone-hint` : undefined;
  const describedBy = [inputProps["aria-describedby"], problem && hintId ? hintId : null].filter(Boolean).join(" ") || undefined;

  return <div>
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
      <select aria-label={`Country code for ${label}`} autoComplete="tel-country-code" className="field" disabled={disabled}
        onChange={(event) => { setCountryCode(event.target.value); if (number.trim()) emit(event.target.value, number); }} value={countryCode}>
        {BY_NAME.map(({ code, country }) => <option key={`${code}-${country}`} value={code}>{country} (+{code})</option>)}
      </select>
      <input {...inputProps} aria-describedby={describedBy} aria-invalid={problem ? true : inputProps["aria-invalid"]} autoComplete="tel-national" className="field" disabled={disabled}
        inputMode="tel" onChange={(event) => changeNumber(event.target.value)} ref={inputRef} type="tel" value={number} />
    </div>
    {problem ? <p className="mt-1 text-xs text-danger" id={hintId}>{problem}</p> : null}
  </div>;
}
