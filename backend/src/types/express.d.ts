declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by the authenticate middleware from a verified access token. */
    user?: { id: number; email: string };
  }
}

export {};
