/**
 * The human-facing ticket reference, `TKT-000042`.
 *
 * DERIVED FROM THE PRIMARY KEY, not stored. data-model.md D5 proposed a stored
 * generated column; MySQL forbids a generated column expression that refers to
 * an AUTO_INCREMENT column, so the derivation happens here instead.
 *
 * This is the better end of that constraint. There is no window in which a row
 * exists without a reference, no uniqueness to enforce beyond the primary key's
 * own, and searching by reference becomes an exact id lookup rather than a
 * string match.
 *
 * ONE SITE. Nothing else formats or parses a reference.
 */

const PREFIX = 'TKT-';
const WIDTH = 6;
const PATTERN = /^TKT-(\d{1,9})$/i;

export function toReference(id: number): string {
  return `${PREFIX}${String(id).padStart(WIDTH, '0')}`;
}

/**
 * Reads a reference back to an id, or null if the text is not one.
 *
 * Accepts a bare number too, so a user typing `42` into the search box finds
 * `TKT-000042` — the reference is a presentation of the id, and refusing to
 * recognise the id itself would be pedantry.
 */
export function parseReference(value: string): number | null {
  const trimmed = value.trim();
  const match = PATTERN.exec(trimmed);

  if (match) {
    const id = Number(match[1]);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  if (/^\d{1,9}$/.test(trimmed)) {
    const id = Number(trimmed);
    return id > 0 ? id : null;
  }

  return null;
}

/** Reference numbers stay Latin-digit and left-to-right in both locales. */
export const REFERENCE_PATTERN = PATTERN;
