import type { NextFunction, Request, Response } from 'express';

import { handled, notFound } from '../../api/v1/errors.js';
import { parseKeyset, toPage } from '../../api/paging.js';
import * as presenter from '../../api/v1/presenters/customer.presenter.js';
import * as customerService from '../../services/customer.service.js';

/**
 * Published customer endpoints (Phase 11, US1).
 *
 * THIS FILE MAY NOT IMPORT A MODEL. `backend/tests/api/no-rule-restatement.test.ts`
 * reads the import graph and fails if it does — the technique Phase 9 used for
 * its egress boundary and Phase 10 for its reporting sources.
 *
 * The reason is FR-010 rather than tidiness. An endpoint that needs a field no
 * service returns invites a small query right here, and that query becomes a
 * second definition of what a customer is — of which contact is primary, of
 * whether a provisional record counts. It will disagree with the screens on the
 * first change to either, and the published answer is the one an outside system
 * has already acted on.
 *
 * So the shape of every handler is: parse, call a service, present.
 */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const keyset = parseKeyset(req.query as Record<string, unknown>);
    const { rows, hasMore } = await customerService.listKeyset(keyset);

    // The service read one row more than asked for and reports whether it got
    // it, so `has_more` costs no extra query and a short page is never mistaken
    // for the last page.
    res.status(200).json(toPage(rows, hasMore, keyset, (row) => presenter.customer(row)));
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      // A malformed identifier answers 404 rather than 400, for the same reason
      // "not yours" does: a 400 would confirm the format of a valid identifier
      // and invite enumeration of it.
      notFound(res);
      return;
    }

    const detail = await customerService.getById(id);

    res.status(200).json(presenter.customerDetail(detail));
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}
