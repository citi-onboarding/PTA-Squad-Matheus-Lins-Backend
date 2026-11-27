import { Router } from "express";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";

import { HttpProblem } from "../../shared/http/problem.js";
import {
  readBearerToken,
  unauthorized,
} from "../../shared/http/require-auth.js";
import { validate } from "../../shared/http/validate.js";
import {
  loginBodySchema,
  loginResponseSchema,
  publicUserSchema,
} from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";

interface AuthRouterDependencies {
  service: AuthService;
  requireAuth: RequestHandler;
}

const LOGIN_ATTEMPTS_PER_MINUTE = 10;

function invalidCredentials(): HttpProblem {
  return new HttpProblem(401, "Unauthorized", "E-mail ou senha incorretos");
}

/** Created per router, so each app (and each test) has its own counter. */
function loginRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: LOGIN_ATTEMPTS_PER_MINUTE,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, _response, next) => {
      next(
        new HttpProblem(
          429,
          "Too Many Requests",
          "Too many sign-in attempts. Try again in a minute.",
        ),
      );
    },
  });
}

export function createAuthRouter({
  service,
  requireAuth,
}: AuthRouterDependencies): Router {
  const router = Router();

  router.post(
    "/login",
    loginRateLimit(),
    validate({ body: loginBodySchema }),
    async (request, response) => {
      const { email, password } = request.body as {
        email: string;
        password: string;
      };
      const result = await service.login(email, password);
      if (!result) throw invalidCredentials();
      response.json(loginResponseSchema.parse(result));
    },
  );

  router.post("/logout", requireAuth, async (request, response) => {
    const token = readBearerToken(request.headers.authorization);
    if (token) await service.logout(token);
    response.status(204).end();
  });

  router.get("/me", requireAuth, async (request, response) => {
    const profile = request.user
      ? await service.getProfile(request.user.id)
      : null;
    if (!profile) throw unauthorized();
    response.json(publicUserSchema.parse(profile));
  });

  return router;
}
