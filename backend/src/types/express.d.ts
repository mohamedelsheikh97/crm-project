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
      roleId: number;
      isActive: boolean;
      mustChangePassword: boolean;
    };
  }
}

export {};
