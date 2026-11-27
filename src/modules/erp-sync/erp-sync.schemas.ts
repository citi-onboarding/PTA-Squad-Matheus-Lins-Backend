import { openApiRegistry } from "../../shared/http/openapi.js";
import { z } from "../../shared/http/openapi-zod.js";

export const entitySyncStatusSchema = z
  .object({
    lastSuccessAt: z.iso.datetime().nullable().openapi({
      description: "End of the last successful run of this entity, or null.",
    }),
    lastAttemptAt: z.iso.datetime().nullable().openapi({
      description: "Start of the last run of this entity, whatever its result.",
    }),
    lastResult: z.enum(["SUCCESS", "FAILURE", "RUNNING"]).nullable(),
  })
  .strict()
  .openapi("EntitySyncStatus");

export const syncStatusSchema = z
  .object({
    customers: entitySyncStatusSchema,
    products: entitySyncStatusSchema,
    receivables: entitySyncStatusSchema,
  })
  .strict()
  .openapi("SyncStatus");

openApiRegistry.registerPath({
  method: "get",
  path: "/sync/status",
  tags: ["sync"],
  summary: "When the ERP data was last synchronized",
  description:
    'For "Dados do ERP de [data e hora]" on every screen (US-002). Any signed-in role.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description:
        "Synchronization status of customers, products, and receivables",
      content: { "application/json": { schema: syncStatusSchema } },
    },
    401: { description: "Missing, unknown, revoked, or expired token" },
  },
});
