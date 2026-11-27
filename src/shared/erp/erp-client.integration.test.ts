import { config } from "dotenv";
import { describe, expect, it } from "vitest";

import { createErpClient } from "./erp-client.js";
import type { ErpClient } from "./erp-client.js";

// Runs against the real ERP with the key from `.env`. CI has no key, so the
// suite is skipped there and stays green while the ERP is offline.
config({ quiet: true });

const apiKey = process.env.ERP_API_KEY ?? "";
const baseUrl = process.env.ERP_BASE_URL ?? "https://pta-erp-api.onrender.com";

type Listing = Exclude<keyof ErpClient, "getCustomer">;

const routes: Record<Listing, string> = {
  listCustomers: "/v1/clientes",
  listProducts: "/v1/produtos",
  listReceivables: "/v1/titulos",
};

/** Reads only the `total` the ERP reports for a route, never the records. */
async function reportedTotal(route: string): Promise<number> {
  const response = await fetch(`${baseUrl}${route}?pagina=1&tamanho=1`, {
    headers: { "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await response.json()) as { total: number };
  return body.total;
}

/** Reads only the code of the first customer the ERP lists, never the record. */
async function firstCustomerCode(): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/clientes?pagina=1&tamanho=1`, {
    headers: { "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await response.json()) as { dados: { codigo: string }[] };
  const code = body.dados[0]?.codigo;
  if (code === undefined) throw new Error("The ERP listed no customer");
  return code;
}

describe.skipIf(!process.env.ERP_API_KEY)(
  "ERP client against the real ERP",
  () => {
    const client = createErpClient({ baseUrl, apiKey, fetch });

    it.each(Object.keys(routes) as Listing[])(
      "%s returns every record reported by the ERP",
      async (listing) => {
        const result = await client[listing]();
        const total = await reportedTotal(routes[listing]);

        expect(total).toBeGreaterThan(0);
        expect(result.items.length + result.rejected.length).toBe(total);
      },
    );

    it.each(Object.keys(routes) as Listing[])(
      "%s returns nothing changed after a future instant",
      async (listing) => {
        const result = await client[listing]({ updatedSince: "2099-01-01" });

        expect(result).toEqual({ items: [], rejected: [] });
      },
    );

    it.each(Object.keys(routes) as Listing[])(
      "%s fails with status 401 for an invalid key",
      async (listing) => {
        const invalidClient = createErpClient({
          baseUrl,
          apiKey: "invalid-key",
          fetch,
        });

        await expect(invalidClient[listing]()).rejects.toMatchObject({
          status: 401,
        });
      },
    );

    it("getCustomer returns an existing customer", async () => {
      const code = await firstCustomerCode();

      const result = await client.getCustomer(code);

      expect(result.status).toBe("found");
      expect(result.status === "found" && result.customer.codigo).toBe(code);
    });

    it("getCustomer reports an unknown code as not found", async () => {
      expect(await client.getCustomer("C-DOES-NOT-EXIST-0")).toEqual({
        status: "not-found",
      });
    });
  },
);
