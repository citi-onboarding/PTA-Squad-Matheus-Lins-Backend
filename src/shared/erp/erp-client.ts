import type { z } from "zod";

import {
  erpCustomerSchema,
  erpPageSchema,
  erpProblemSchema,
  erpProductSchema,
  erpReceivableSchema,
} from "./erp-schemas.js";
import type {
  ErpCustomer,
  ErpPage,
  ErpProduct,
  ErpReceivable,
} from "./erp-schemas.js";
import { ErpRequestError } from "./erp-errors.js";
import { withRetry } from "./with-retry.js";

export interface ErpClientDependencies {
  baseUrl: string;
  apiKey: string;
  fetch: typeof fetch;
}

export interface ErpListOptions {
  /** Only records changed after this ISO date or date-time (`atualizadoDesde`). */
  updatedSince?: string;
}

export interface ErpRejectedRecord {
  /** `codigo` or `numero` of the record, when it could be read. */
  key: string | number | undefined;
  page: number;
  issues: { path: string; message: string }[];
}

export interface ErpListing<T> {
  items: T[];
  rejected: ErpRejectedRecord[];
}

/** Outcome of looking up one customer by code. */
export type ErpCustomerLookup =
  | { status: "found"; customer: ErpCustomer }
  | { status: "not-found" }
  | { status: "invalid"; issues: { path: string; message: string }[] };

export interface ErpClient {
  listCustomers(options?: ErpListOptions): Promise<ErpListing<ErpCustomer>>;
  listProducts(options?: ErpListOptions): Promise<ErpListing<ErpProduct>>;
  listReceivables(options?: ErpListOptions): Promise<ErpListing<ErpReceivable>>;
  getCustomer(code: string): Promise<ErpCustomerLookup>;
}

const PAGE_SIZE = 50;
const TIMEOUT_MILLISECONDS = 60_000;

function readRetryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("Retry-After")?.trim();
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

/** Builds the error for a non-2xx response; keeps only Problem fields, never the body. */
async function toHttpError(response: Response): Promise<ErpRequestError> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = undefined;
  }
  const problem = erpProblemSchema.safeParse(body);
  return new ErpRequestError({
    kind: "http",
    status: response.status,
    detail: problem.success ? problem.data.detail : undefined,
    erros: problem.success ? problem.data.erros : undefined,
    retryAfterSeconds: readRetryAfterSeconds(response),
  });
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/** Describes one ERP listing route: where it lives, how to validate it, how to name a record. */
interface ErpResource<T> {
  path: string;
  schema: z.ZodType<T>;
  readKey: (record: unknown) => string | number | undefined;
}

function readField(record: unknown, field: string): unknown {
  return typeof record === "object" && record !== null
    ? (record as Record<string, unknown>)[field]
    : undefined;
}

function readStringField(field: string) {
  return (record: unknown) => {
    const value = readField(record, field);
    return typeof value === "string" ? value : undefined;
  };
}

function readNumberField(field: string) {
  return (record: unknown) => {
    const value = readField(record, field);
    return typeof value === "number" ? value : undefined;
  };
}

const customers: ErpResource<ErpCustomer> = {
  path: "/v1/clientes",
  schema: erpCustomerSchema,
  readKey: readStringField("codigo"),
};

const products: ErpResource<ErpProduct> = {
  path: "/v1/produtos",
  schema: erpProductSchema,
  readKey: readStringField("codigo"),
};

const receivables: ErpResource<ErpReceivable> = {
  path: "/v1/titulos",
  schema: erpReceivableSchema,
  readKey: readNumberField("numero"),
};

/** Adds a record to `items` when valid, or to `rejected` with its key and issues only. */
function collectRecord<T>(
  resource: ErpResource<T>,
  record: unknown,
  page: number,
  listing: ErpListing<T>,
): void {
  const parsed = resource.schema.safeParse(record);
  if (parsed.success) {
    listing.items.push(parsed.data);
    return;
  }
  listing.rejected.push({
    key: resource.readKey(record),
    page,
    issues: toIssues(parsed.error),
  });
}

/** Keeps only the path and message of each Zod issue, never the input value. */
function toIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function createErpClient({
  baseUrl,
  apiKey,
  fetch: fetchImplementation,
}: ErpClientDependencies): ErpClient {
  const root = baseUrl.replace(/\/+$/, "");

  /** One authenticated ERP call; returns the parsed JSON body, or `undefined` when it is not JSON. */
  async function request(url: URL): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
      });
    } catch (error) {
      throw new ErpRequestError({
        kind: isTimeout(error) ? "timeout" : "network",
      });
    }

    if (!response.ok) {
      throw await toHttpError(response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  }

  async function fetchPage(
    path: string,
    page: number,
    updatedSince: string | undefined,
  ): Promise<ErpPage> {
    const url = new URL(`${root}${path}`);
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanho", String(PAGE_SIZE));
    if (updatedSince !== undefined) {
      url.searchParams.set("atualizadoDesde", updatedSince);
    }

    const { status, body } = await request(url);
    const envelope = erpPageSchema.safeParse(body);
    if (!envelope.success) {
      throw new ErpRequestError({ kind: "malformed", status });
    }
    return envelope.data;
  }

  async function getCustomer(code: string): Promise<ErpCustomerLookup> {
    const url = new URL(`${root}/v1/clientes/${encodeURIComponent(code)}`);
    let body: unknown;
    try {
      ({ body } = await withRetry(() => request(url)));
    } catch (error) {
      if (error instanceof ErpRequestError && error.status === 404) {
        return { status: "not-found" };
      }
      throw error;
    }

    const parsed = erpCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return { status: "invalid", issues: toIssues(parsed.error) };
    }
    return { status: "found", customer: parsed.data };
  }

  async function list<T>(
    resource: ErpResource<T>,
    options: ErpListOptions,
  ): Promise<ErpListing<T>> {
    const listing: ErpListing<T> = { items: [], rejected: [] };
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page += 1) {
      const envelope = await withRetry(() =>
        fetchPage(resource.path, page, options.updatedSince),
      );
      totalPages = envelope.totalPaginas;
      for (const record of envelope.dados) {
        collectRecord(resource, record, page, listing);
      }
    }

    return listing;
  }

  return {
    listCustomers: (options = {}) => list(customers, options),
    listProducts: (options = {}) => list(products, options),
    listReceivables: (options = {}) => list(receivables, options),
    getCustomer,
  };
}
