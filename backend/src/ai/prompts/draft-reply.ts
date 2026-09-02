import type { AiMessage } from '../providers/types.js';

/**
 * The suggested-reply prompt (Phase 9, US2).
 *
 * A DRAFT, NOT AN OUTBOX. Nothing this produces is sent, queued, or recorded as
 * a message — the agent reads it, edits it, and sends it under their own name
 * (FR-026, FR-027). The prompt is written for that: it produces a body an agent
 * can edit, not a finished dispatch.
 *
 * THE COMMITMENT BOUNDARY IS IN THE SYSTEM PROMPT (FR-031) AND IN THE REVIEW
 * STEP. Stating it here reduces how often a draft promises a refund; the agent
 * reading before sending is what actually prevents it reaching a customer. The
 * spec is honest that this is the arrangement, and so is this comment: a prompt
 * instruction is a request, and the human in the loop is the control.
 */
export interface DraftInput {
  readonly subject: string;
  readonly messages: ReadonlyArray<{
    readonly direction: 'inbound' | 'outbound';
    readonly body: string;
  }>;
  readonly articles: ReadonlyArray<{
    readonly id: number;
    readonly title: string;
    readonly excerpt: string;
  }>;
  readonly agentName: string;
}

const SYSTEM: Readonly<Record<'ar' | 'en', string>> = {
  en: [
    'You draft replies for a customer support agent to review, edit, and send.',
    'Write in English. The agent will send it under their own name, so write as the',
    'organisation speaking to its customer.',
    '',
    'Rules:',
    '- Answer the customer’s most recent message.',
    '- Use only what the conversation and the reference material below support.',
    '- NEVER promise a refund, compensation, a delivery date, a price, or any',
    '  contractual term. If the customer asked for one, say the request has been',
    '  passed on — do not commit the organisation to it.',
    '- If you do not have enough information to answer, write a short reply that',
    '  asks the customer for what is missing.',
    '- No subject line, no signature block, no placeholders like [name].',
    'Write only the message body.',
  ].join('\n'),

  ar: [
    'أنت تكتب مسودات ردود يراجعها موظف الدعم ويعدّلها ثم يرسلها.',
    'اكتب بالعربية. سيرسلها الموظف باسمه، فاكتب بصفتك المؤسسة وهي تخاطب عميلها.',
    '',
    'القواعد:',
    '- أجب عن آخر رسالة من العميل.',
    '- استخدم فقط ما تدعمه المحادثة والمراجع أدناه.',
    '- لا تَعِد إطلاقاً باسترداد مبلغ أو تعويض أو موعد تسليم أو سعر أو أي التزام',
    '  تعاقدي. إذا طلب العميل ذلك، فقل إن الطلب أُحيل للجهة المختصة.',
    '- إذا لم تتوفر معلومات كافية، اكتب رداً قصيراً يسأل العميل عمّا ينقص.',
    '- بلا سطر موضوع وبلا توقيع وبلا عناصر نائبة مثل [الاسم].',
    'اكتب نص الرسالة فقط.',
  ].join('\n'),
};

export function system(lang: 'ar' | 'en'): string {
  return SYSTEM[lang];
}

export function messages(input: DraftInput): AiMessage[] {
  const parts = [`Subject: ${input.subject}`, '', 'Conversation:'];

  for (const message of input.messages) {
    parts.push(`${message.direction === 'inbound' ? 'Customer' : 'Support'}: ${message.body}`);
  }

  if (input.articles.length > 0) {
    parts.push('', 'Reference material from the knowledge base:');

    for (const article of input.articles) {
      // Labelled with its id so the response can cite it and the service can
      // verify the citation against what it actually supplied (FR-029).
      parts.push(`[article ${article.id}] ${article.title}: ${article.excerpt}`);
    }
  }

  return [{ role: 'user', content: parts.join('\n') }];
}
