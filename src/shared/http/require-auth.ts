import type { RequestHandler } from "express";

import type { Role } from "../database/generated/enums.js";
import { HttpProblem } from "./problem.js";

export interface AuthenticatedUser {
  id: number;
  role: Role;
  sellerCode: string | null;
}

export type Authenticate = (token: string) => Promise<AuthenticatedUser | null>;

const BEARER = /^Bearer (\S+)$/;

export function unauthorized(): HttpProblem {
  return new HttpProblem(401, "Unauthorized", "Authentication is required.");
}

/** Reads the token from the request, if any, without validating it. */
export function readBearerToken(header: string | undefined): string | null {
  return header?.match(BEARER)?.[1] ?? null;
}

/**
 * Rejects the request with 401 unless it carries `Authorization: Bearer
 * <token>` of an active session. `authenticate` is injected by the app, so
 * shared code never imports a module.
 */
export function requireAuth(authenticate: Authenticate): RequestHandler {
  return async (request, _response, next) => {
    const token = readBearerToken(request.headers.authorization);
    const user = token ? await authenticate(token) : null;
    if (!user) {
      next(unauthorized());
      return;
    }
    request.user = user;
    next();
  };
}
