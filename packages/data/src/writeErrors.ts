/**
 * Human wording for the database errors a person can actually cause.
 *
 * A unique index doing its job is not a fault — it is the server telling
 * someone they have already created this. But Postgres says so as
 * `duplicate key value violates unique constraint
 * "dropdown_masters_tenant_id_master_type_value_key"`, and both clients put
 * whatever they catch straight in front of the viewer, so that string is what
 * a salesperson reads.
 *
 * This maps the constraints we know about to a sentence, at the point the
 * write is made, so web and mobile improve together rather than one of them
 * diverging. The server stays authoritative: nothing here checks anything in
 * advance, it only re-words the refusal that came back.
 *
 * The original text is never discarded — it is kept on `technicalMessage` for
 * logs and for diagnosing an error whose wording we have not mapped.
 */

/** A write the database refused, in wording meant for the person who tried it. */
export class WriteRejected extends Error {
  /** The database's own message, kept for diagnostics. */
  readonly technicalMessage: string;

  constructor(message: string, technicalMessage: string) {
    super(message);
    this.name = "WriteRejected";
    this.technicalMessage = technicalMessage;
  }
}

/**
 * Constraint name → what a person should read instead.
 *
 * Keyed by the constraint exactly as Postgres names it in the message. Add a
 * row here when a real refusal is seen in the field; an unmapped constraint
 * falls through to the database's own wording rather than to a vague apology,
 * because a wrong guess is worse than a technical truth.
 */
export const CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  dropdown_masters_tenant_id_master_type_value_key:
    "A dropdown item with this value already exists in this category.",
};

/**
 * The sentence to show for a database message, or `null` if we have nothing
 * better to say than what the database already said.
 */
export function describeWriteError(message: string): string | null {
  for (const [constraint, wording] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (message.includes(constraint)) return wording;
  }
  return null;
}

/**
 * The error a data-layer write should throw. Mapped wording when we have it,
 * the database's own message when we do not — never a swallowed failure.
 */
export function writeError(message: string): Error {
  const described = describeWriteError(message);
  return described ? new WriteRejected(described, message) : new Error(message);
}
