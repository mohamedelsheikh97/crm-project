declare module 'express-serve-static-core' {
  interface Request {
    /**
     * Populated by the authenticate middleware from a verified access token
     * PLUS a fresh read of the user's current row. The token identifies; the
     * database authorizes (research.md D1).
     */
    user?: {
      id: number;
      email: string;
      fullName: string;
      roleId: number;
      isActive: boolean;
      mustChangePassword: boolean;
    };

    /**
     * Populated by `authenticate-portal` from a verified PORTAL access token
     * plus a fresh read of the account, its contact, and the contact's customer
     * (Phase 8, research.md D1, D10).
     *
     * A SEPARATE FIELD FROM `user`, never an extra shape inside it. The two are
     * different realms: `req.user` means a row in `users` with a role and
     * permission grants, and `req.portal` means a customer with neither. Sharing
     * the field would mean every `req.user` check in five phases of code
     * suddenly had to ask which kind it was holding — and the ones that forgot
     * would be the bugs.
     *
     * NO ROLE AND NO PERMISSIONS, deliberately (FR-014). Portal capability comes
     * from holding a portal session; there is nothing here for
     * `requirePermission` to read, and it is never mounted on a portal route.
     *
     * `contactId` is the one that matters. Clarifications Q2 scopes every portal
     * read to the signing-in CONTACT, not to the customer — so `customerId` is
     * present for the redundant outer clause in `portalScope` and for audit
     * labels, not as a visibility boundary of its own.
     */
    portal?: {
      /** `portal_accounts.id` — the token's subject. */
      accountId: number;
      /** `customer_contacts.id` — what portal visibility is computed from. */
      contactId: number;
      customerId: number;
      /** The contact's own email address. Used as the audit actor label. */
      email: string;
      language: 'ar' | 'en' | null;
    };

    /**
     * Populated by `authenticate-client` from a verified machine credential
     * (Phase 11, research D1).
     *
     * A THIRD SUBJECT FIELD, and separate for exactly the reason `portal` is
     * separate from `user`: these are different realms. `req.user` is a row in
     * `users` with a role; `req.portal` is a customer contact with neither;
     * `req.apiClient` is an external SYSTEM with its own permission grants and
     * no person behind it at all.
     *
     * IT DOES NOT IMPERSONATE A USER. The constitution's machine-client
     * paragraph forbids it, because attributing an automated action to whichever
     * administrator configured the credential makes the audit trail misleading —
     * a nightly ERP sync would appear as somebody's 3am login.
     *
     * `permissions` is read from the credential's own grants on every request,
     * never from a token claim, so revocation and scope changes take effect
     * immediately (FR-019).
     */
    apiClient?: {
      /** `api_clients.id`. */
      id: number;
      /** The public half of the credential — appears in audit records. */
      clientId: string;
      name: string;
      permissions: ReadonlySet<string>;
    };

    /**
     * The exact bytes of the request body, captured by `express.json`'s verify
     * callback in app.ts (Phase 5, research.md D5).
     *
     * Webhook signature verification MUST use this and never a re-serialised
     * `req.body`: a provider signs what it sent, and JSON round-tripping
     * changes key order and whitespace.
     */
    rawBody?: Buffer;
  }
}

export {};
