import { MAX_LIMIT, DEFAULT_LIMIT } from './paging.js';
import { ROUTES, toOpenApiPath } from './v1/catalog.js';

/**
 * The interface's own description, GENERATED (Phase 11, FR-005, FR-006).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILT FROM THE ROUTE CATALOG, SO "DOCUMENTED" AND "SERVED" ARE ONE FACT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `api/v1/catalog.ts` declares the routes; the router mounts them from it and
 * this builds the document from it. There is no second list to fall out of step,
 * which is what FR-005 is actually asking for — hand-written API documentation
 * is wrong within weeks, and wrong documentation is worse than none because an
 * integrator trusts it and debugs their own code first.
 *
 * `backend/tests/api/openapi.test.ts` reconciles the document against the
 * mounted router, using the technique from Phase 10's `route-auth.test.ts` —
 * which exists because Phase 9 shipped a real defect the suite could not see.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY NO `zod-to-json-schema` DEPENDENCY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The plan left the choice open between that package and a local mapper. The
 * response shapes here are the presenters' output — a dozen flat objects with
 * strings, numbers, nulls and one array — and the request parameters are the
 * three paging fields plus a handful of enums. A schema converter earns its
 * place when schemas are large, nested and changing; here it would add a
 * dependency to translate structures small enough to state directly, and the
 * translation is the part a reader most needs to be able to check by eye.
 *
 * If the interface grows write endpoints with real request bodies, that trade
 * changes and the converter becomes worth adding.
 */

const FIGURE_SCHEMA = {
  type: 'object',
  description:
    "Phase 10's figure envelope. Every field is required, because a number without them is not " +
    'trustworthy: `count`/`total` because a rate reads identically at 2-of-3 and 6,700-of-10,000; ' +
    '`excluded` so a narrower figure is explained rather than merely smaller; `suppressed` because ' +
    'below the floor `value` is NULL and NOT zero — zero is a claim, null is an absence; and ' +
    '`reflects_current_state` because recategorising a ticket today changes last month’s report.',
  required: [
    'value',
    'count',
    'total',
    'excluded',
    'suppressed',
    'period',
    'filters',
    'computed_at',
    'reflects_current_state',
  ],
  properties: {
    value: {
      description: 'The figure. NULL when `suppressed` — never 0.',
      nullable: true,
    },
    count: { type: 'integer', description: 'Records behind `value`.' },
    total: { type: 'integer', description: 'Records considered.' },
    excluded: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reason', 'count'],
        properties: {
          reason: { type: 'string' },
          count: { type: 'integer' },
        },
      },
    },
    suppressed: {
      type: 'boolean',
      description: 'True when the sample is too small to support a rate. `value` is then null.',
    },
    period: {
      type: 'object',
      required: ['from', 'to', 'time_zone'],
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        time_zone: {
          type: 'string',
          description: "The business calendar's zone — not the server's and not the caller's.",
        },
      },
    },
    filters: { type: 'object', additionalProperties: true },
    computed_at: {
      type: 'string',
      format: 'date-time',
      description: 'The last SUCCESSFUL computation, not the last attempt.',
    },
    reflects_current_state: {
      type: 'boolean',
      description:
        'Always true. These figures describe records as they are now, not as they were during ' +
        'the period. Store this flag with the figures if you retain them.',
    },
  },
} as const;

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'details'],
      properties: {
        code: {
          type: 'string',
          description: 'THE CONTRACT. Branch on this, never on `message`.',
        },
        message: {
          type: 'string',
          description:
            'For a human reading a log. Wording may change without a version bump, and it is ' +
            'English regardless of Accept-Language — a machine consumer has no language.',
        },
        details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['message'],
            properties: { field: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;

const PAGING_PARAMETERS = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
  },
  {
    name: 'cursor',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description:
      'OPAQUE. Echo back exactly what `next_cursor` gave you. Its contents are not part of ' +
      'this contract and a hand-built cursor is refused. Pairing one with a different `since` ' +
      'than it was issued under is also refused, rather than silently reinterpreted.',
  },
  {
    name: 'since',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date-time' },
    description:
      'Records changed at or after this moment. INCLUSIVE, so you will re-receive the boundary ' +
      'record — cheaper than an exclusive bound that can skip a record written in the same ' +
      'second. Use this to reconcile after an outage rather than reading the whole collection.',
  },
] as const;

const PERIOD_PARAMETERS = [
  {
    name: 'from',
    in: 'query',
    required: true,
    schema: { type: 'string', format: 'date' },
    description: "Resolved in the business calendar's timezone, which the response states.",
  },
  { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
] as const;

const COMMON_RESPONSES = {
  '400': {
    description: 'A parameter is malformed. `details` names each field.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '401': {
    description:
      'Credential missing, malformed, unknown, expired or revoked — all the same answer, so ' +
      'the refusal cannot be used to learn whether a client identifier exists.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '403': {
    description: 'Authenticated, but this credential lacks the permission. Never an empty list.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '404': {
    description:
      'No such record — OR the record is outside this credential’s reach. Deliberately ' +
      'indistinguishable, so identifiers cannot be enumerated.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '429': {
    description: 'Too many requests. `Retry-After` states when. Distinct from 403 by design.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
} as const;

export function document(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of ROUTES) {
    const key = toOpenApiPath(route.path);

    paths[key] ??= {};

    const parameters: unknown[] = [];

    for (const match of route.path.matchAll(/:([A-Za-z_]\w*)/g)) {
      parameters.push({
        name: match[1],
        in: 'path',
        required: true,
        schema: { type: 'integer' },
      });
    }

    if (route.paged) parameters.push(...PAGING_PARAMETERS);
    if (route.period) parameters.push(...PERIOD_PARAMETERS);

    const responses: Record<string, unknown> = {
      '200': { description: route.summary },
      ...COMMON_RESPONSES,
    };

    if (route.path === '/tickets/:id') {
      responses['200'] = {
        description:
          'The ticket. A MERGED ticket is returned normally with ' +
          '`merged_into_ticket_id` set — not an error, and never a copy of the survivor. ' +
          'Follow the pointer if you need the surviving ticket; counting both would count the ' +
          'same work twice.',
      };
    }

    paths[key]![route.method] = {
      summary: route.summary,
      security: route.permission === null ? [] : [{ bearerCredential: [] }],
      ...(route.permission === null || route.permission === 'authenticated'
        ? {}
        : {
            description:
              `Requires \`${route.permission}\`.` +
              (route.onDenied === 'hide'
                ? ' Answers 404 rather than 403 without it: absent rather than ' +
                  'present-and-withheld, so its existence is not disclosed.'
                : ''),
          }),
      ...(parameters.length > 0 ? { parameters } : {}),
      responses,
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'CRM-Support published interface',
      version: '1',
      description:
        'Read-only in version 1. The version is a PATH SEGMENT: a request without one is not ' +
        'served, and there is no default. Clients MUST tolerate unknown fields — adding a field ' +
        'is not a breaking change, while removing or retyping one requires a new version. ' +
        'Adding a value to an enumerated field IS breaking, which is stricter than most APIs: a ' +
        'client that throws on an unrecognised `status` would break when a ticket status is ' +
        'added, and this system has added statuses before.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearerCredential: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An administrator-issued credential, presented as `<client_id>.<secret>`. The ' +
            'secret is shown once at issuance and cannot be retrieved afterwards. Rotation ' +
            'accepts both secrets for an overlap so an integration can be updated without a ' +
            'failed request; revocation takes effect on the next request.',
        },
      },
      schemas: { Figure: FIGURE_SCHEMA, Error: ERROR_SCHEMA },
    },
    security: [{ bearerCredential: [] }],
    paths,
  };
}
