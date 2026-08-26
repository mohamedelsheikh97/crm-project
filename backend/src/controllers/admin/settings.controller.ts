import type { Request, Response } from 'express';

/**
 * The configuration shell (FR-043). Each section exists and is navigable now;
 * its content arrives with the phase that owns it. Returning i18n keys rather
 * than labels keeps Constitution Principle I intact.
 */
const SECTIONS = [
  { key: 'categories', nameKey: 'settings.section.categories', availableFrom: 'phase-3' },
  { key: 'templates', nameKey: 'settings.section.templates', availableFrom: 'phase-5' },
  { key: 'channels', nameKey: 'settings.section.channels', availableFrom: 'phase-5' },
] as const;

export function list(_req: Request, res: Response): void {
  res.status(200).json({ sections: SECTIONS });
}
