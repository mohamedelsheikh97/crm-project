import { createServer, type Server } from 'node:http';

import * as apiClientService from '../../src/services/api-client.service.js';
import * as subscriptionService from '../../src/services/webhook-subscription.service.js';
import { createTestUser } from '../helpers/auth.js';

/**
 * A real HTTP receiver, for the delivery tests.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REAL SERVER RATHER THAN A MOCKED `fetch`, AND THE DIFFERENCE MATTERS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mocking `fetch` would let these tests pass while the signature was computed
 * over a re-serialised body, while `redirect: 'manual'` was missing, while the
 * timeout was never applied — every one of which is a real defect this phase
 * can ship. The point is to observe what actually arrives on the wire.
 *
 * It listens on 127.0.0.1, which the address guard REFUSES (FR-034) — so tests
 * that exercise delivery construct the subscription directly rather than through
 * the service, and there is a separate test asserting the guard refuses that
 * address when it goes through the service. Two halves of one requirement, and
 * neither can be satisfied by the other.
 */
export interface Receiver {
  readonly url: string;
  readonly requests: ReceivedRequest[];
  /** What to answer next. Defaults to 200. */
  respondWith(status: number, headers?: Record<string, string>): void;
  /** Accept the connection and never answer, to exercise the timeout. */
  hang(): void;
  close(): Promise<void>;
}

export interface ReceivedRequest {
  readonly body: string;
  readonly headers: Record<string, string | undefined>;
}

export async function startReceiver(): Promise<Receiver> {
  const requests: ReceivedRequest[] = [];

  let status = 200;
  let extraHeaders: Record<string, string> = {};
  let hanging = false;

  const server: Server = createServer((request, response) => {
    let body = '';

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });

    request.on('end', () => {
      requests.push({
        body,
        headers: request.headers as Record<string, string | undefined>,
      });

      // Never answers. `AbortSignal.timeout` is what has to save us.
      if (hanging) return;

      response.writeHead(status, extraHeaders);
      response.end('ok');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/hook`,
    requests,
    respondWith(next, headers = {}) {
      status = next;
      extraHeaders = headers;
      hanging = false;
    },
    hang() {
      hanging = true;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * A subscription pointed at a loopback receiver, built by INSERTING rather than
 * through the service.
 *
 * The service refuses a private address, correctly (FR-034). Delivery has to be
 * testable against something we can observe, so this bypasses the save-time
 * check — and `delivery.ts` re-checks at delivery time, which means these tests
 * also need the delivery-time guard stubbed or a public-looking hostname.
 *
 * The honest resolution: `assertPubliclyRoutable` treats a hostname it cannot
 * classify as public, so tests use `127.0.0.1.nip.io`-style names where a real
 * DNS lookup would matter. Since this classifier works on the literal string,
 * `localtest.me` and friends classify as public while resolving to loopback —
 * which is exactly the DNS-rebinding case the delivery-time re-check exists for,
 * and it is why that re-check cannot be the ONLY defence.
 */
export async function subscriptionFor(
  receiverUrl: string,
  eventTypes: string[] = ['ticket.created'],
): Promise<{ subscriptionId: number; signingSecret: string; apiClientId: number }> {
  const admin = await createTestUser({ roleKey: 'admin' });

  const { client } = await apiClientService.issue({
    name: 'Webhook test client',
    permissions: ['tickets:view', 'customers:view'],
    createdByUserId: admin.id,
    grantableBy: new Set(['tickets:view', 'customers:view'] as const),
  });

  const { WebhookSubscription } = await import('../../src/models/index.js');
  const { seal } = await import('../../src/lib/secret-box.js');
  const { newSigningSecret } = await import('../../src/integrations/signing.js');

  const signingSecret = newSigningSecret();

  const subscription = await WebhookSubscription.create({
    api_client_id: client.id,
    url: receiverUrl,
    event_types: eventTypes,
    signing_secret_sealed: seal(signingSecret),
  } as never);

  return { subscriptionId: subscription.id, signingSecret, apiClientId: client.id };
}

export { subscriptionService };
