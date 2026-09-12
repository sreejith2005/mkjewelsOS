import { useEffect, useState } from "react";

/**
 * The settled form of a value that changes faster than the work it triggers.
 *
 * A search box is the case this exists for: typing "invoice" is seven state
 * changes, and if the loader's dependency list carries the raw term that is
 * seven round trips, six of which are thrown away. The screen still shows every
 * keystroke immediately — only the value handed to the loader waits.
 *
 * The first value is returned without a delay, so a screen does not open with
 * an empty filter it then has to re-apply.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (Object.is(settled, value)) return undefined;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, settled, value]);

  return settled;
}
