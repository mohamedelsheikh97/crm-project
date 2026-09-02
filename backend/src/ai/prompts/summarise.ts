import type { AiMessage } from '../providers/types.js';

/**
 * The summarisation prompt (Phase 9, US1).
 *
 * A BUILDER TAKING TYPED INPUTS, never a Sequelize instance — the same
 * composition rule Phase 8 applied to `PortalTicketView`, and for the same
 * reason. A builder handed a model row could spread it, and the next field
 * added to `tickets` would silently enter a prompt nobody re-reviewed.
 *
 * WHAT MAY BE IN HERE is fixed by contracts/grounding-contract.md: the ticket's
 * correspondence, its subject, and its created date. NOT internal notes, not
 * SLA state, not the assignee's identity, not automation history, not other
 * tickets.
 *
 * INTERNAL NOTES ARE EXCLUDED and it is worth saying why twice. FR-023 requires
 * the rule be stated and enforced; beyond that, excluding them means no summary
 * can ever be unsafe to show on a customer-facing surface. That removes a whole
 * class of future mistake rather than guarding against it — a later phase that
 * decides to show a customer their own ticket summary cannot leak a
 * colleague-to-colleague aside, because one was never in the material.
 */
export interface SummaryInput {
  readonly subject: string;
  readonly createdAt: Date;
  readonly messages: ReadonlyArray<{
    readonly direction: 'inbound' | 'outbound';
    readonly occurredAt: Date;
    readonly body: string;
  }>;
}

/**
 * CONSTANT PER LANGUAGE. No runtime string is interpolated into it, which is
 * what keeps ticket content data rather than instructions, and what lets the
 * prefix cache hit across every ticket in the system.
 */
const SYSTEM: Readonly<Record<'ar' | 'en', string>> = {
  en: [
    'You summarise customer support ticket conversations for the support agent who is picking',
    'the ticket up. Write in English.',
    '',
    'Cover three things, in this order:',
    '1. What the customer originally asked for.',
    '2. What has been done so far.',
    '3. What is still outstanding — what the agent needs to do next.',
    '',
    'Be brief and concrete. Prefer specifics from the conversation over general statements.',
    'If the conversation does not say what is outstanding, say that rather than guessing.',
    'Do not invent facts, commitments, dates, or amounts that are not in the conversation.',
    'Write plain prose. No preamble, no sign-off, no headings.',
  ].join('\n'),

  ar: [
    'أنت تلخّص محادثات تذاكر دعم العملاء للموظف الذي سيتولى التذكرة. اكتب بالعربية.',
    '',
    'غطِّ ثلاثة أمور بهذا الترتيب:',
    '١. ما الذي طلبه العميل في الأصل.',
    '٢. ما الذي تم إنجازه حتى الآن.',
    '٣. ما الذي ما زال معلقاً — ما الذي يجب على الموظف فعله تالياً.',
    '',
    'كن موجزاً ومحدداً. اعتمد على تفاصيل المحادثة بدل العبارات العامة.',
    'إذا لم توضح المحادثة ما هو المعلق، قل ذلك بدل التخمين.',
    'لا تختلق وقائع أو التزامات أو تواريخ أو مبالغ غير موجودة في المحادثة.',
    'اكتب نصاً عادياً بلا مقدمات ولا خاتمة ولا عناوين.',
  ].join('\n'),
};

export function system(lang: 'ar' | 'en'): string {
  return SYSTEM[lang];
}

export function messages(input: SummaryInput): AiMessage[] {
  const lines = [
    `Subject: ${input.subject}`,
    `Opened: ${input.createdAt.toISOString().slice(0, 10)}`,
    '',
    'Conversation:',
    ...input.messages.map(
      (message) =>
        `[${message.occurredAt.toISOString().slice(0, 16).replace('T', ' ')}] ` +
        `${message.direction === 'inbound' ? 'Customer' : 'Support'}: ${message.body}`,
    ),
  ];

  return [{ role: 'user', content: lines.join('\n') }];
}
