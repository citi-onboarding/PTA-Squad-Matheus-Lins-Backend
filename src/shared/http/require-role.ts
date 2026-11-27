import type { RequestHandler } from "express";

import type { Role } from "../database/generated/enums.js";
import { HttpProblem } from "./problem.js";
import { unauthorized } from "./require-auth.js";

/** Use after `requireAuth`: 403 unless the user has one of `roles` (RN-08). */
export function requireRole(...roles: Role[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(request.user.role)) {
      next(
        new HttpProblem(403, "Forbidden", "Você não tem acesso a esta página"),
      );
      return;
    }
    next();
  };
}
