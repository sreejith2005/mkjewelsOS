import { z } from 'zod';

export const WALKIN_WEDDING_MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
] as const;

const answer = z.union([z.string(), z.number()]).nullish().transform(value => value == null ? '' : String(value));
const schema = z.object({
  occupation: answer, occupation_other: answer, bridal_or_non_bridal: answer,
  wedding_month: answer.transform(value => WALKIN_WEDDING_MONTHS[Number(value) - 1] ?? value), wedding_year: answer, beverage_other: answer,
  sugar_other: answer, snack_other: answer,
});
export type WalkinProfileDefaults = Partial<z.infer<typeof schema>>;

/** Historical JSON crosses the API boundary; only recognized scalar answers enter controls. */
export function parseWalkinProfileDefaults(value: unknown): WalkinProfileDefaults {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
