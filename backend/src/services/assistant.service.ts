import { createHash } from 'node:crypto';

import { assistantSpeaks, groundingFloor } from '../ai/features.js';
import { invoke, recordRefusal, AiUnavailableError } from '../ai/invoke.js';
import { predominantLang, type ContentLang } from '../ai/lang.js';
import * as prompt from '../ai/prompts/assistant.js';
import { localProviderFor } from '../ai/providers/local-factory.js';
import { AssistantConversation } from '../models/assistant-conversation.model.js';
import { AssistantMessage } from '../models/assistant-message.model.js';

import * as searchService from './kb-search.service.js';

/**
 * The customer-facing assistant (Phase 9, US3, FR-033 - FR-043).
 *
 * FOUR STEPS, AND ONLY THE THIRD INVOLVES A MODEL (research D3,
 * contracts/grounding-contract.md):
 *
 *   1. RETRIEVE with `audience: 'customer'` as a literal.
 *   2. GATE on the grounding floor. Below it, DO NOT CALL THE MODEL.
 *   3. GENERATE with the retrieved excerpts as the only corpus.
 *   4. VERIFY every citation was actually supplied; discard if not.
 *
 * Step 2 is the most valuable code in the phase. The commonest and most
 * damaging failure — a fluent, confident answer to a question the knowledge
 * base does not cover — is prevented by NOT MAKING THE CALL. It is free,
 * deterministic, and testable by exact assertion.
 *
 * Step 4 catches a fabricated citation. It does NOT catch a paraphrase that
 * misstates a real article, and nothing cheap does; SC-016 assigns that to
 * human review, and this comment does not pretend otherwise.
 *
 * THIS SERVICE MUST NEVER IMPORT `external-factory.js`. That is enforced by
 * lint, by `backend/tests/ai/egress.test.ts` reading the import graph, and by
 * the location assertion in `invoke.ts` (research D2, FR-008).
 */
export interface AssistantReply {
  readonly conversationId: number;
  readonly body: string;
  readonly citedArticles: ReadonlyArray<{ slug: string | null; title: string }>;
  /** True when the assistant declined and the customer should be offered a ticket. */
  readonly needsHuman: boolean;
}

export class AssistantUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AssistantUnavailableError';
  }
}

const MAX_ARTICLES = 5;
const MAX_HISTORY = 10;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AssistantIdentity {
  readonly portalAccountId?: number;
  readonly anonToken?: string;
}

/** Explicit requests for a person, in both languages. */
const HUMAN_REQUEST =
  /\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|someone)\b|\bhuman\b|\bagent\b|(?:أريد|اريد)\s+(?:التحدث|الحديث)|موظف|شخص\s+حقيقي/i;

export async function respond(
  identity: AssistantIdentity,
  conversationId: number | null,
  body: string,
): Promise<AssistantReply> {
  const text = body.trim();

  if (text.length === 0) {
    throw new AssistantUnavailableError('empty_message');
  }

  const conversation = await resolveConversation(identity, conversationId, text);

  if (!assistantSpeaks(conversation.lang)) {
    // A language the assistant is not good enough in gets NO assistant, not a
    // worse one (research D4). The caller falls back to the Phase 8 route.
    throw new AssistantUnavailableError('ai_feature_disabled');
  }

  await AssistantMessage.create({
    conversation_id: conversation.id,
    role: 'customer',
    body: text,
  });

  const context = { subjectType: 'conversation' as const, subjectId: conversation.id };

  // FR-036: an explicit request for a person is honoured immediately, with no
  // further attempts to answer (SC-018). Checked before retrieval so it cannot
  // be outranked by a good article match.
  if (HUMAN_REQUEST.test(text)) {
    await recordRefusal('assistant', context, 'refused_ungrounded');
    return decline(conversation.id, conversation.lang);
  }

  // STEP 1 — retrieve. `audience: 'customer'` is a LITERAL here, exactly as
  // Phase 7's public controller passes it. Only published, customer-visible
  // articles have index rows at all (Phase 7 D4), so FR-033 is a description of
  // what is in the context rather than an instruction the model may ignore.
  let hits: searchService.SearchHit[];

  try {
    hits = (
      await searchService.search({
        query: text,
        lang: conversation.lang,
        audience: 'customer',
        limit: MAX_ARTICLES,
      })
    ).items;
  } catch {
    hits = [];
  }

  // STEP 2 — the floor. No model call below it.
  const best = hits[0]?.score ?? 0;

  if (hits.length === 0 || best < groundingFloor()) {
    await recordRefusal('assistant', context, 'refused_ungrounded');
    return decline(conversation.id, conversation.lang);
  }

  // STEP 3 — generate, with the retrieved excerpts as the only corpus. No
  // ticket, no customer record, no other conversation is present, so FR-035
  // holds by absence rather than by instruction.
  const history = await AssistantMessage.findAll({
    where: { conversation_id: conversation.id },
    order: [['id', 'ASC']],
    limit: MAX_HISTORY,
  });

  let text_out: string;

  try {
    const result = await invoke(
      localProviderFor(),
      {
        feature: 'assistant',
        system: prompt.system(conversation.lang),
        messages: prompt.messages({
          question: text,
          history: history.slice(0, -1).map((row) => ({ role: row.role, body: row.body })),
          articles: hits.map((hit) => ({
            id: hit.articleId,
            title: hit.title,
            excerpt: hit.excerpt,
          })),
        }),
        maxOutput: 600,
        contentLang: conversation.lang,
      },
      context,
    );

    text_out = result.text;
  } catch (error) {
    // FR-008b: no fallback to the external provider exists. The assistant
    // becomes unavailable and the customer keeps the Phase 8 route (FR-042).
    if (error instanceof AiUnavailableError) {
      throw new AssistantUnavailableError(error.code);
    }
    throw new AssistantUnavailableError('ai_unavailable');
  }

  // STEP 4 — verify. A cited id that retrieval did not supply is a fabrication,
  // and the whole answer is discarded rather than shown with the bad reference
  // removed: if the model invented a source, its claims are not trustworthy.
  const supplied = new Set(hits.map((hit) => hit.articleId));
  const cited = [...text_out.matchAll(/\[article (\d+)\]/g)].map((m) => Number(m[1]));

  const fabricated = cited.some((id) => !supplied.has(id));

  if (fabricated || cited.length === 0) {
    await recordRefusal('assistant', context, 'refused_ungrounded');
    return decline(conversation.id, conversation.lang);
  }

  const citedHits = hits.filter((hit) => cited.includes(hit.articleId));

  const clean = text_out
    .replace(/\[article \d+\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  await AssistantMessage.create({
    conversation_id: conversation.id,
    role: 'assistant',
    body: clean,
    cited_article_ids: citedHits.map((hit) => hit.articleId),
  });

  await conversation.update({ last_activity_at: new Date() });

  return {
    conversationId: conversation.id,
    body: clean,
    // SLUG AND TITLE, NEVER ID: Phase 8's FR-065 rule that no customer surface
    // exposes an internal id, and the slug is what the public KB URL uses.
    citedArticles: citedHits.map((hit) => ({ slug: hit.slug, title: hit.title })),
    needsHuman: false,
  };
}

/**
 * The refusal. LOCALE TEXT, NOT GENERATED — this sentence must be the same
 * every time and must not depend on a model being reachable.
 */
const DECLINE: Readonly<Record<ContentLang, string>> = {
  en: 'I cannot answer that from our help articles. Would you like me to pass this to a colleague?',
  ar: 'لا أستطيع الإجابة عن ذلك من مقالات المساعدة لدينا. هل تريد تحويل السؤال إلى أحد الزملاء؟',
};

async function decline(conversationId: number, lang: ContentLang): Promise<AssistantReply> {
  const body = DECLINE[lang];

  await AssistantMessage.create({
    conversation_id: conversationId,
    role: 'assistant',
    body,
    cited_article_ids: null,
  });

  return { conversationId, body, citedArticles: [], needsHuman: true };
}

async function resolveConversation(
  identity: AssistantIdentity,
  conversationId: number | null,
  firstMessage: string,
): Promise<AssistantConversation> {
  if (conversationId !== null) {
    const existing = await AssistantConversation.findByPk(conversationId);

    // Scoped to the identity that owns it. A conversation belonging to another
    // portal account is NOT FOUND, never forbidden — the Phase 8 rule.
    if (!existing || !owns(existing, identity)) {
      throw new AssistantUnavailableError('not_found');
    }

    return existing;
  }

  return AssistantConversation.create({
    portal_account_id: identity.portalAccountId ?? null,
    anon_token_hash: identity.anonToken ? hashToken(identity.anonToken) : null,
    // Fixed at the first message and not re-derived per turn (research D9): a
    // conversation that switched language mid-exchange would be answered from a
    // corpus and a quality gate chosen for a different one.
    lang: predominantLang(firstMessage),
    last_activity_at: new Date(),
  });
}

function owns(conversation: AssistantConversation, identity: AssistantIdentity): boolean {
  if (identity.portalAccountId) {
    return conversation.portal_account_id === identity.portalAccountId;
  }

  if (identity.anonToken) {
    return conversation.anon_token_hash === hashToken(identity.anonToken);
  }

  return false;
}
