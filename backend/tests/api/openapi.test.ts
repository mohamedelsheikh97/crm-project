import { describe, expect, it } from 'vitest';

import { document } from '../../src/api/openapi.js';
import { ROUTES, toOpenApiPath } from '../../src/api/v1/catalog.js';

/**
 * The document describes what is served (Phase 11, US1, FR-005, FR-006, T049).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A RECONCILIATION, AND THE TECHNIQUE EXISTS BECAUSE OF A REAL DEFECT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 9 shipped a bare-mounted router that put a public surface behind a
 * token, and the suite could not see it — it was found by curling the running
 * application. Phase 10's `tests/reports/route-auth.test.ts` was written in
 * response: read the router, fail if anything mounted is not covered.
 *
 * The same shape applies here to documentation. FR-005 requires the document to
 * be DERIVED rather than maintained beside the code, and the reason is not
 * tidiness: hand-written API documentation is wrong within weeks, and wrong
 * documentation is worse than none because an integrator trusts it and debugs
 * their own code first.
 *
 * The generator reads `api/v1/catalog.ts` and so does the router, so they cannot
 * disagree — which makes this test's job to prove that property holds rather
 * than to compare two hand-kept lists.
 */
describe('the generated OpenAPI document', () => {
  const doc = document();
  const paths = doc.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;

  it('has routes to describe, so nothing below passes vacuously', () => {
    expect(ROUTES.length).toBeGreaterThan(5);
    expect(Object.keys(paths).length).toBeGreaterThan(5);
  });

  it('describes EVERY mounted route', () => {
    for (const route of ROUTES) {
      const key = toOpenApiPath(route.path);

      expect(paths[key], `${route.path} is mounted but not described`).toBeDefined();
      expect(
        paths[key]![route.method],
        `${route.method.toUpperCase()} ${route.path} is mounted but not described`,
      ).toBeDefined();
    }
  });

  it('describes NOTHING that is not mounted', () => {
    /**
     * The other direction, and it matters as much.
     *
     * A documented endpoint that does not exist sends an integrator to write
     * code against a 404 — and they will assume they have the path wrong before
     * they assume our documentation is.
     */
    const mounted = new Set(ROUTES.map((route) => `${route.method} ${toOpenApiPath(route.path)}`));

    for (const [key, methods] of Object.entries(paths)) {
      for (const method of Object.keys(methods)) {
        expect(
          mounted.has(`${method} ${key}`),
          `${method} ${key} is described but not mounted`,
        ).toBe(true);
      }
    }
  });

  it('states the authority each route needs', () => {
    for (const route of ROUTES) {
      const operation = paths[toOpenApiPath(route.path)]![route.method] as unknown as {
        security?: unknown[];
        description?: string;
      };

      if (route.permission === null) {
        // Explicitly empty, not absent: an empty `security` array is how
        // OpenAPI says "this one needs nothing", while omitting it inherits the
        // document-level requirement and would be wrong.
        expect(operation.security, `${route.path} should be unauthenticated`).toEqual([]);
        continue;
      }

      expect(operation.security, `${route.path} should require a credential`).not.toEqual([]);

      if (route.permission !== 'authenticated') {
        // The permission is NAMED, so an integrator reading the document knows
        // what to ask their administrator for.
        expect(operation.description, `${route.path} does not name its permission`).toContain(
          route.permission,
        );
      }
    }
  });

  it('says the agent report is ABSENT rather than refused', () => {
    const operation = paths['/reports/agents']!.get as unknown as { description?: string };

    /**
     * The document has to explain the 404, or an integrator will read it as a
     * bug and open a support ticket. It is a deliberate answer: FR-013 wants the
     * report absent rather than present-and-withheld, because a 403 tells the
     * caller that per-agent figures exist and somebody else can read them.
     */
    expect(operation.description).toMatch(/404/);
    expect(operation.description).toMatch(/absent rather than/i);
  });

  it('documents the paging parameters on every paged collection', () => {
    for (const route of ROUTES.filter((candidate) => candidate.paged)) {
      const operation = paths[toOpenApiPath(route.path)]![route.method] as unknown as {
        parameters?: Array<{ name: string; description?: string }>;
      };

      const names = (operation.parameters ?? []).map((parameter) => parameter.name);

      expect(names, `${route.path} is paged but does not document it`).toEqual(
        expect.arrayContaining(['limit', 'cursor', 'since']),
      );

      // The cursor's opacity has to be stated, or a client will decode it and
      // come to depend on a shape we intend to change.
      const cursor = (operation.parameters ?? []).find((parameter) => parameter.name === 'cursor');

      expect(cursor?.description).toMatch(/OPAQUE/);
    }
  });

  it('documents the period parameters on every report', () => {
    for (const route of ROUTES.filter((candidate) => candidate.period)) {
      const operation = paths[toOpenApiPath(route.path)]![route.method] as unknown as {
        parameters?: Array<{ name: string; required?: boolean }>;
      };

      const names = (operation.parameters ?? []).map((parameter) => parameter.name);

      expect(names, `${route.path} is a report but does not document from/to`).toEqual(
        expect.arrayContaining(['from', 'to']),
      );

      // Required, because a report without a period is not a report — and a
      // defaulted period would silently change what a client is asking for.
      for (const parameter of operation.parameters ?? []) {
        if (parameter.name === 'from' || parameter.name === 'to') {
          expect(parameter.required).toBe(true);
        }
      }
    }
  });

  it('turns Express parameters into OpenAPI parameters', () => {
    // `:id` becomes `{id}`, and the path parameter is declared. A document
    // carrying Express syntax would not load in any tool an integrator uses.
    expect(paths['/customers/{id}']).toBeDefined();
    expect(paths['/customers/:id']).toBeUndefined();

    const operation = paths['/customers/{id}']!.get as unknown as {
      parameters?: Array<{ name: string; in: string; required?: boolean }>;
    };

    const idParameter = (operation.parameters ?? []).find((parameter) => parameter.in === 'path');

    expect(idParameter?.name).toBe('id');
    expect(idParameter?.required).toBe(true);
  });

  it('declares the shared error and figure schemas', () => {
    const components = doc.components as { schemas: Record<string, unknown> };

    expect(components.schemas.Error).toBeDefined();
    expect(components.schemas.Figure).toBeDefined();
  });

  it('documents every refusal a caller can actually receive', () => {
    for (const route of ROUTES) {
      if (route.permission === null) continue;

      const operation = paths[toOpenApiPath(route.path)]![route.method]!;

      for (const status of ['400', '401', '403', '404', '429']) {
        expect(
          operation.responses[status],
          `${route.path} does not document a ${status}`,
        ).toBeDefined();
      }
    }
  });

  it('is valid enough to load: version, servers and info are present', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect((doc.info as { version: string }).version).toBe('1');
    expect(doc.servers).toEqual([{ url: '/api/v1' }]);

    // Serialisable — a document with a circular reference or an undefined would
    // fail here rather than when a tool tried to read it.
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(JSON.stringify(doc)).not.toContain('undefined');
  });

  it('describes the credential scheme an integrator has to use', () => {
    const components = doc.components as {
      securitySchemes: Record<string, { type: string; scheme: string; description: string }>;
    };

    const scheme = components.securitySchemes.bearerCredential;

    expect(scheme.type).toBe('http');
    expect(scheme.scheme).toBe('bearer');

    /**
     * FR-006: sufficient to make a successful first request.
     *
     * The three facts an integrator needs and cannot guess: the bearer's shape,
     * that the secret is shown once, and that rotation has an overlap so
     * updating it is not an outage.
     */
    expect(scheme.description).toMatch(/<client_id>\.<secret>/);
    expect(scheme.description).toMatch(/shown once/i);
    expect(scheme.description).toMatch(/overlap/i);
  });
});
