/**
 * The invitation email (Phase 8, FR-002d, FR-048's bilingual requirement).
 *
 * TWO DECISIONS HERE, both departures from what the codebase does elsewhere, and
 * both deliberate.
 *
 * **This is prose, not an i18n key.** Every outbound body in this project so far
 * carries `JSON.stringify({ key, params })` — `alert.service.ts` says why: "what
 * must never happen is a hardcoded English sentence reaching an Arabic reader,
 * so the key travels rather than prose." That rule was written for mail to
 * AGENTS, where the recipient has an account, a stored language, and an
 * application that resolves keys. A portal invitation goes to somebody who has
 * none of those: they are not a user yet, and the whole point of the message is
 * to become one. A JSON key in a customer's inbox is not a deferred
 * translation, it is an unreadable email.
 *
 * **Both languages, in one message.** The invitation is the ONE outbound message
 * in this system whose recipient's language is genuinely unknown — they have no
 * account, so `preferred_language` does not exist yet, and guessing from a
 * customer record's other fields would be guessing. Sending Arabic and English
 * together costs a few lines of an email and removes the guess entirely. Every
 * message after this one has an account to read a language from.
 *
 * THE CONTENT IS SHAPED BY ONE RISK: an unexpected email containing a link and
 * asking for a password is indistinguishable from phishing unless it tells the
 * recipient enough to check it. So it names the organisation, names the address
 * it was sent to, says who to contact if they were not expecting it, and asks
 * for nothing at all in the mail itself.
 */

export interface InvitationMailInput {
  /** The customer record's display name — who the recipient will recognise. */
  organisationName: string;
  /** The address this was sent to, stated so the recipient can verify it. */
  email: string;
  /** Absolute URL of the acceptance page, carrying the one-time token. */
  acceptUrl: string;
  /** Whole hours until it expires. */
  expiresInHours: number;
}

export function invitationSubject(): string {
  return 'Your support portal invitation · دعوة إلى بوابة الدعم';
}

export function invitationBody(input: InvitationMailInput): string {
  const { organisationName, email, acceptUrl, expiresInHours } = input;
  const days = Math.round(expiresInHours / 24);
  const validFor = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${expiresInHours} hours`;
  const validForAr = days >= 1 ? `${days} يوم` : `${expiresInHours} ساعة`;

  return [
    'ENGLISH',
    '',
    `${organisationName} has invited you to the customer support portal.`,
    '',
    'There you can raise a request, follow what is happening with it, read the',
    'full conversation, and tell us how we did once it is resolved.',
    '',
    'To set your password and sign in:',
    acceptUrl,
    '',
    `This link works once and is valid for ${validFor}.`,
    '',
    `It was sent to ${email}. If you were not expecting this, you can ignore this`,
    'email — nothing has been created yet, and the link will simply expire. If you',
    'would like to check that it is genuine, contact us the way you normally do',
    'rather than by replying to this message.',
    '',
    '——————————————————————————',
    '',
    'العربية',
    '',
    `دعتك ${organisationName} إلى بوابة دعم العملاء.`,
    '',
    'يمكنك من خلالها إنشاء طلب، ومتابعة ما يحدث بشأنه، وقراءة المحادثة كاملة،',
    'وإخبارنا بمدى رضاك بعد حلّه.',
    '',
    'لتعيين كلمة المرور وتسجيل الدخول:',
    acceptUrl,
    '',
    `هذا الرابط يعمل مرة واحدة وصالح لمدة ${validForAr}.`,
    '',
    `أُرسل إلى ${email}. إذا لم تكن تتوقع هذه الرسالة فيمكنك تجاهلها — لم يُنشأ`,
    'أي حساب بعد، وسينتهي الرابط من تلقاء نفسه. وإذا أردت التأكد من أنها رسالة',
    'حقيقية، تواصل معنا بالطريقة المعتادة بدلًا من الرد على هذه الرسالة.',
  ].join('\n');
}

/**
 * The password-reset email.
 *
 * Same two decisions for the same reasons: prose rather than a key, and both
 * languages, because a reset is requested from the sign-in screen by somebody
 * who may not have reached their language preference yet.
 */
export function resetSubject(): string {
  return 'Reset your support portal password · إعادة تعيين كلمة مرور بوابة الدعم';
}

export function resetBody(input: {
  email: string;
  resetUrl: string;
  expiresInHours: number;
}): string {
  return [
    'ENGLISH',
    '',
    'Someone asked to reset the support portal password for this address.',
    '',
    'If it was you:',
    input.resetUrl,
    '',
    `This link works once and is valid for ${input.expiresInHours} hours.`,
    '',
    'If it was not you, ignore this email. Your password has not changed and',
    'nobody has been given access.',
    '',
    '——————————————————————————',
    '',
    'العربية',
    '',
    'طلب أحدهم إعادة تعيين كلمة مرور بوابة الدعم لهذا العنوان.',
    '',
    'إذا كنت أنت:',
    input.resetUrl,
    '',
    `هذا الرابط يعمل مرة واحدة وصالح لمدة ${input.expiresInHours} ساعة.`,
    '',
    'إذا لم تكن أنت، تجاهل هذه الرسالة. لم تتغير كلمة مرورك ولم يُمنح أحد أي وصول.',
  ].join('\n');
}
