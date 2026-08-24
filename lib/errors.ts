/** Turn a callable error into a user-facing message. The proxy throws resource-exhausted
 *  when the month's budget is spent — everything else surfaces its own message. */
export function describeGenError(err: unknown): string {
  if ((err as { code?: string }).code === "functions/resource-exhausted") {
    return "You've reached this month's budget for AI generation. Ask the owner to raise it.";
  }
  return (err as Error).message;
}
