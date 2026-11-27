import { Role } from "../../shared/database/generated/enums.js";
import { openApiRegistry } from "../../shared/http/openapi.js";
import { z } from "../../shared/http/openapi-zod.js";

export const loginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1),
  })
  .openapi("LoginBody");

export const publicUserSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    email: z.string(),
    role: z.enum(Role),
  })
  .openapi("AuthUser");

export const loginResponseSchema = z
  .object({ token: z.string(), user: publicUserSchema })
  .openapi("LoginResponse");

const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string(),
    requestId: z.string().optional(),
  })
  .openapi("Problem");

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: problemSchema } },
});

const bearerAuth = openApiRegistry.registerComponent(
  "securitySchemes",
  "bearerAuth",
  { type: "http", scheme: "bearer" },
);
const authenticated = [{ [bearerAuth.name]: [] }];

openApiRegistry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["auth"],
  summary: "Sign in with email and password",
  request: {
    body: { content: { "application/json": { schema: loginBodySchema } } },
  },
  responses: {
    200: {
      description: "Signed in",
      content: { "application/json": { schema: loginResponseSchema } },
    },
    400: problem("Invalid body"),
    401: problem("E-mail ou senha incorretos"),
    429: problem("More than 10 attempts per minute from this IP"),
  },
});

openApiRegistry.registerPath({
  method: "post",
  path: "/auth/logout",
  tags: ["auth"],
  summary: "End the current session",
  security: authenticated,
  responses: {
    204: { description: "Session ended" },
    401: problem("Missing, unknown, revoked, or expired token"),
  },
});

openApiRegistry.registerPath({
  method: "get",
  path: "/auth/me",
  tags: ["auth"],
  summary: "Return the signed-in user",
  security: authenticated,
  responses: {
    200: {
      description: "Signed-in user",
      content: { "application/json": { schema: publicUserSchema } },
    },
    401: problem("Missing, unknown, revoked, or expired token"),
  },
});
