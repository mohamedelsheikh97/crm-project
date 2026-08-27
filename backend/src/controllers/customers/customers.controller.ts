import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as customerService from '../../services/customer.service.js';
import * as exportService from '../../services/export.service.js';

/**
 * HTTP concerns only — no business logic, no model access. Duplicate detection,
 * the contact-required rule, and optimistic locking all live in the service, so
 * they hold for any caller.
 */

function actorFrom(req: Request): { id: number; email: string } {
  if (!req.user) {
    throw unauthenticated();
  }

  return { id: req.user.id, email: req.user.email };
}

function parseActive(value: unknown): boolean | 'all' | undefined {
  if (value === 'all') return 'all';
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * A path segment that is not a number is a route that does not exist, not a
 * lookup for a customer whose id is NaN. Without this a request to an unmatched
 * literal path — `/customers/export` before that route was added — reaches the
 * service and produces a 500 instead of a 404.
 */
function customerId(req: Request): number {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await customerService.list({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      company: typeof req.query.company === 'string' ? req.query.company : undefined,
      isActive: parseActive(req.query.isActive),
      page: req.query.page,
      pageSize: req.query.pageSize,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await customerService.getById(customerId(req)));
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const created = await customerService.create(
      req.body ?? {},
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updated = await customerService.update(
      customerId(req),
      req.body ?? {},
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await customerService.setActive(customerId(req), false, actorFrom(req), auditContextFrom(req));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function reactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await customerService.setActive(customerId(req), true, actorFrom(req), auditContextFrom(req));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * Live feedback while typing — an AID, not the barrier.
 *
 * The barrier is the 409 on save, because a matching customer can be created
 * between a check and a save (research.md D5).
 */
export async function checkDuplicates(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body ?? {};
    const exclude = body.excludeCustomerId;

    const duplicates = await customerService.checkDuplicates(
      body.contacts,
      exclude === undefined || exclude === null ? null : Number(exclude),
    );

    res.status(200).json({ duplicates });
  } catch (error) {
    next(error);
  }
}

/**
 * Accepts the SAME query parameters as the list endpoint, so an export is
 * always "what I am currently looking at" rather than a separate query someone
 * has to keep in step.
 */
export async function exportCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await exportService.exportCustomers(
      {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        company: typeof req.query.company === 'string' ? req.query.company : undefined,
        isActive: parseActive(req.query.isActive),
      },
      actorFrom(req),
      auditContextFrom(req),
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
    res.status(200).send(result.csv);
  } catch (error) {
    next(error);
  }
}
