import type { NextFunction, Request, Response } from 'express';

import { buildInboundSubmission } from '../../channels/form/inbound.js';
import { notFound } from '../../errors/app-error.js';
import * as formService from '../../services/form.service.js';
import * as intakeService from '../../services/intake.service.js';

/**
 * PUBLIC form endpoints — two of the four unauthenticated surfaces in this
 * phase (FR-105).
 *
 * Neither discloses anything about the organisation's data. A submission from a
 * recognised customer and one from a complete stranger produce the SAME
 * response, because a different one would turn this endpoint into an oracle for
 * "is this email address one of your customers?" (FR-106).
 */

/** The visitor's language, from the query, defaulting to English. */
function localeFrom(req: Request): string {
  return req.query.locale === 'ar' ? 'ar' : 'en';
}

export async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = String(req.params.slug);

    // An unpublished form is indistinguishable from one that does not exist.
    res.status(200).json(await formService.publicForm(slug, localeFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function submit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = String(req.params.slug);
    const locale = localeFrom(req);

    // Server-side validation (FR-083). The browser's `required` attribute is a
    // convenience; anyone can post directly. The failing field is named in the
    // SUBMISSION'S language, because that is the language the person reading
    // the message chose.
    const validated = await formService.validateSubmission(slug, req.body ?? {}, locale);

    const submissionId = `form-${validated.form.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const message = buildInboundSubmission({
      submissionId,
      // A form that asks for no contact detail produces a provisional customer
      // named after the submission — the honest outcome, because we genuinely
      // do not know who sent it.
      senderIdentity: validated.senderIdentity || submissionId,
      formTitle: locale === 'ar' ? validated.form.title_ar : validated.form.title_en,
      answers: validated.answers,
    });

    const outcome = await intakeService.accept(
      message,
      JSON.stringify({ slug, locale, answers: validated.answers }),
    );

    if (outcome.status === 'failed') throw new Error(outcome.reason);

    // DELIBERATELY MINIMAL. No ticket id, no reference, no customer — a
    // stranger who submits a form must not be handed a handle on internal
    // records, and Phase 8 is where customers get a way to follow one up.
    res.status(202).json({ received: true });
  } catch (error) {
    next(error);
  }
}

export { notFound };
