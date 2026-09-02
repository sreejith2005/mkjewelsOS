import { useRef, useState, type KeyboardEvent } from "react";
import { Star } from "lucide-react";

const RATINGS = [1, 2, 3, 4, 5] as const;

export function RatingField({ disabled, label, onChange, registerRef, value }: { disabled: boolean; label: string; onChange: (value: number) => void; registerRef?: (node: HTMLElement | null) => void; value: number | undefined }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const select = (rating: number) => { if (!disabled) onChange(rating); };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, rating: number) => {
    const next = event.key === "ArrowRight" || event.key === "ArrowUp" ? Math.min(5, rating + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? Math.max(1, rating - 1)
      : event.key === "Home" ? 1 : event.key === "End" ? 5 : null;
    if (next === null) return;
    event.preventDefault(); select(next); refs.current.get(next)?.focus();
  };
  const active = hovered ?? value ?? 0;
  return <div aria-label={label} className="flex w-fit gap-1" onMouseLeave={() => setHovered(null)} role="radiogroup">
    {RATINGS.map((rating) => <button
      aria-checked={value === rating}
      aria-label={`${rating} stars`}
      className={`grid size-10 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${rating <= active ? "text-gold" : "text-soft-grey hover:text-champagne"}`}
      disabled={disabled}
      key={rating}
      onClick={() => select(rating)}
      onFocus={() => setHovered(rating)}
      onKeyDown={(event) => onKeyDown(event, rating)}
      onMouseEnter={() => setHovered(rating)}
      ref={(node) => { if (node) refs.current.set(rating, node); else refs.current.delete(rating); if (rating === 1) registerRef?.(node); }}
      role="radio"
      tabIndex={value === rating || (value === undefined && rating === 1) ? 0 : -1}
      type="button"
    ><Star aria-hidden className="size-7" fill={rating <= active ? "currentColor" : "none"} /></button>)}
  </div>;
}

