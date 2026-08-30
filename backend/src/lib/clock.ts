/**
 * The one authoritative clock, at the precision the database actually stores.
 *
 * MySQL `DATETIME` is second-precision. A `new Date()` written straight into a
 * column and then returned in the same response reports milliseconds the stored
 * row does not have — so the value a client receives on write differs from the
 * one it receives on the next read. That is a small lie with real consequences:
 * an idempotent operation looks like it changed something, and any
 * value-to-value comparison (`due_warning_sent_for <> due_at`, for instance)
 * compares a truncated column against an untruncated one and always disagrees.
 *
 * Truncating at the moment of stamping makes written, stored, and returned
 * values identical without an extra reload query.
 *
 * It is also the single place "now" is decided on the server, which is what
 * FR-020 requires: "overdue" must mean the same thing for a viewer in Cairo and
 * a viewer in London, so it can never be computed from a browser clock.
 */
export function now(): Date {
  const date = new Date();
  date.setMilliseconds(0);
  return date;
}

/** Truncates a caller-supplied date to the precision the database stores. */
export function toStorablePrecision(date: Date): Date {
  const truncated = new Date(date.getTime());
  truncated.setMilliseconds(0);
  return truncated;
}
