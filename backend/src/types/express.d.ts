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
