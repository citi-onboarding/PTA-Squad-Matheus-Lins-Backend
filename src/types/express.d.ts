import type { Logger } from "pino";

import type { AuthenticatedUser } from "../shared/http/require-auth.js";

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      user?: AuthenticatedUser;
    }
  }
}

export {};
