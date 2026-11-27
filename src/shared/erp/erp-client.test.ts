import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createErpClient } from "./erp-client.js";

const baseUrl = "https://erp.test";
const apiKey = "test-secret-key-123";

function customer(codigo: string, overrides: Record<string, unknown> = {}) {
  return {
    codigo,
    razaoSocial: `Customer ${codigo}`,
    cnpj: "23775684000107",
    cidade: "Recife",
    uf: "PE",
    segmento: "Construction",
    limiteCreditoCentavos: 5_000_000,
    vendedor: "V001",
    dataCadastro: "2021-12-20",
    status: "ATIVO",
    atualizadoEm: "2026-11-05T09:00:00-03:00",
    ...overrides,
  };
}

function product(codigo: string, overrides: Record<string, unknown> = {}) {
  return {
    codigo,
    descricao: `Product ${codigo}`,
    categoria: "Cables",
    unidade: "UN",
    precoTabelaCentavos: 12_345,
    ativo: true,
    atualizadoEm: "2026-11-10T09:00:00-03:00",
    ...overrides,
  };
}

function receivable(numero: number, overrides: Record<string, unknown> = {}) {
  return {
    numero,
    cliente: "C0003",
    pedidoErp: 4_501,
    parcela: "1/3",
    valorCentavos: 150_000,
    emissao: "2026-10-05",
    vencimento: "2026-11-05",
    pagamento: null,
    status: "EM_ABERTO",
    atualizadoEm: "2026-11-05T06:00:00-03:00",
    ...overrides,
  };
}

function page(
  dados: unknown[],
  pagina: number,
  totalPaginas: number,
  total = dados.length,
) {
  return { dados, pagina, tamanho: 50, total, totalPaginas };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function problemResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Problem",
      status,
      detail: `ERP answered ${status}`,
      instance: "/v1/clientes",
      erros: [{ campo: "tamanho", mensagem: "must be at most 50" }],
    }),
    {
      status,
      headers: { "content-type": "application/problem+json", ...headers },
    },
  );
}

function createFakeFetch() {
  return vi.fn<typeof fetch>();
}

function requestedUrl(
  fakeFetch: ReturnType<typeof createFakeFetch>,
  call: number,
) {
  const input = fakeFetch.mock.calls[call]?.[0];
  return new URL(String(input instanceof Request ? input.url : input));
}

function requestedInit(
  fakeFetch: ReturnType<typeof createFakeFetch>,
  call: number,
) {
  return fakeFetch.mock.calls[call]?.[1];
}

/** Captures the outcome of a listing so a rejection is never left unhandled. */
function capture<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
}

/** Runs every pending retry timer and returns the listing outcome. */
async function settle<T>(promise: Promise<T>) {
  const outcome = capture(promise);
  await vi.runAllTimersAsync();
  return outcome;
}

describe("createErpClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads every customer page with page size 50 and the API key", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(jsonResponse(page([customer("C0001")], 1, 3, 3)))
      .mockResolvedValueOnce(jsonResponse(page([customer("C0002")], 2, 3, 3)))
      .mockResolvedValueOnce(jsonResponse(page([customer("C0003")], 3, 3, 3)));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value, error } = await settle(client.listCustomers());

    expect(error).toBeUndefined();
    expect(value?.items.map((item) => item.codigo)).toEqual([
      "C0001",
      "C0002",
      "C0003",
    ]);
    expect(value?.rejected).toEqual([]);
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    for (const [index, expectedPage] of [1, 2, 3].entries()) {
      const url = requestedUrl(fakeFetch, index);
      expect(url.origin + url.pathname).toBe("https://erp.test/v1/clientes");
      expect(url.searchParams.get("pagina")).toBe(String(expectedPage));
      expect(url.searchParams.get("tamanho")).toBe("50");
      expect(url.searchParams.has("atualizadoDesde")).toBe(false);
      const init = requestedInit(fakeFetch, index);
      expect(new Headers(init?.headers).get("X-Api-Key")).toBe(apiKey);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reads products and receivables from their routes", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(jsonResponse(page([product("P00001")], 1, 1)))
      .mockResolvedValueOnce(jsonResponse(page([receivable(900_457)], 1, 1)));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const products = await settle(client.listProducts());
    const receivables = await settle(client.listReceivables());

    expect(products.value?.items).toEqual([product("P00001")]);
    expect(receivables.value?.items).toEqual([receivable(900_457)]);
    expect(requestedUrl(fakeFetch, 0).pathname).toBe("/v1/produtos");
    expect(requestedUrl(fakeFetch, 1).pathname).toBe("/v1/titulos");
  });

  it("sends updatedSince as atualizadoDesde on every page", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(jsonResponse(page([product("P00001")], 1, 2, 2)))
      .mockResolvedValueOnce(jsonResponse(page([product("P00002")], 2, 2, 2)));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    await settle(
      client.listProducts({ updatedSince: "2026-11-23T12:00:00-03:00" }),
    );

    expect(fakeFetch).toHaveBeenCalledTimes(2);
    for (const call of [0, 1]) {
      expect(
        requestedUrl(fakeFetch, call).searchParams.get("atualizadoDesde"),
      ).toBe("2026-11-23T12:00:00-03:00");
    }
  });

  it("returns empty results when the ERP reports no records", async () => {
    const fakeFetch = createFakeFetch().mockResolvedValueOnce(
      jsonResponse(page([], 1, 0, 0)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(
      client.listCustomers({ updatedSince: "2099-01-01" }),
    );

    expect(value).toEqual({ items: [], rejected: [] });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a receivable without payment date", async () => {
    const fakeFetch = createFakeFetch().mockResolvedValueOnce(
      jsonResponse(page([receivable(1, { pagamento: null })], 1, 1)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.listReceivables());

    expect(value?.items).toEqual([receivable(1, { pagamento: null })]);
    expect(value?.rejected).toEqual([]);
  });

  it("returns valid records and rejects one invalid record in the middle of a page", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(jsonResponse(page([customer("C0001")], 1, 2, 4)))
      .mockResolvedValueOnce(
        jsonResponse(
          page(
            [
              customer("C0002"),
              customer("C0003", { status: "SUSPENSO" }),
              customer("C0004"),
            ],
            2,
            2,
            4,
          ),
        ),
      );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value, error } = await settle(client.listCustomers());

    expect(error).toBeUndefined();
    expect(value?.items.map((item) => item.codigo)).toEqual([
      "C0001",
      "C0002",
      "C0004",
    ]);
    expect(value?.rejected).toHaveLength(1);
    expect(value?.rejected[0]).toMatchObject({ key: "C0003", page: 2 });
    expect(value?.rejected[0]?.issues).toEqual([
      expect.objectContaining({ path: "status", message: expect.any(String) }),
    ]);
    expect(JSON.stringify(value?.rejected)).not.toContain("Customer C0003");
  });

  it("rejects an invalid receivable using its numero as key", async () => {
    const fakeFetch = createFakeFetch().mockResolvedValueOnce(
      jsonResponse(page([receivable(77, { valorCentavos: 10.5 })], 1, 1)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.listReceivables());

    expect(value?.items).toEqual([]);
    expect(value?.rejected[0]).toMatchObject({ key: 77, page: 1 });
    expect(value?.rejected[0]?.issues[0]?.path).toBe("valorCentavos");
  });

  it("rejects an invalid record without a readable key", async () => {
    const fakeFetch = createFakeFetch().mockResolvedValueOnce(
      jsonResponse(page([product("P00001", { codigo: 42 })], 1, 1)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.listProducts());

    expect(value?.items).toEqual([]);
    expect(value?.rejected).toEqual([
      {
        key: undefined,
        page: 1,
        issues: [expect.objectContaining({ path: "codigo" })],
      },
    ]);
  });

  it("retries a malformed page and fails if it stays malformed", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(jsonResponse({ pagina: 1, total: 3 })),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.listCustomers());

    expect(error).toMatchObject({ name: "ErpRequestError", kind: "malformed" });
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });

  it("retries a page whose body is not JSON and recovers", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(page([customer("C0001")], 1, 1)));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.listCustomers());

    expect(value?.items).toHaveLength(1);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("fails immediately with the Problem details on 422", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(problemResponse(422)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.listCustomers());

    expect(error).toMatchObject({
      name: "ErpRequestError",
      kind: "http",
      status: 422,
      detail: "ERP answered 422",
      erros: [{ campo: "tamanho", mensagem: "must be at most 50" }],
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("fails with status 401 without leaking the API key", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(problemResponse(401)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.listReceivables());

    expect(error).toMatchObject({ status: 401 });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const exposed = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
    expect(exposed).not.toContain(apiKey);
  });

  it("passes Retry-After to the retry policy on 429", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(problemResponse(429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(jsonResponse(page([customer("C0001")], 1, 1)));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const outcome = capture(client.listCustomers());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    const { value } = await outcome;

    expect(value?.items).toHaveLength(1);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces the daily limit as RateLimitedError", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(problemResponse(429, { "Retry-After": "3600" })),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.listProducts());

    expect(error).toMatchObject({
      name: "RateLimitedError",
      retryAfterSeconds: 3_600,
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a server error with an HTML body and reports only its status", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.listCustomers());

    expect(error).toMatchObject({
      kind: "http",
      status: 502,
      detail: undefined,
      erros: [],
    });
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });

  it("retries a network failure and recovers", async () => {
    const fakeFetch = createFakeFetch()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(page([product("P00001")], 1, 1)));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.listProducts());

    expect(value?.items).toHaveLength(1);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("gives every ERP call a 60-second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fakeFetch = createFakeFetch().mockResolvedValueOnce(
      jsonResponse(page([customer("C0001")], 1, 1)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    await settle(client.listCustomers());

    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(requestedInit(fakeFetch, 0)?.signal).toBe(
      timeout.mock.results[0]?.value,
    );
  });

  it("retries a timed-out call as a timeout failure", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.reject(
        new DOMException("The operation timed out.", "TimeoutError"),
      ),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.listCustomers());

    expect(error).toMatchObject({ name: "ErpRequestError", kind: "timeout" });
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });

  it("retries only the failing page", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(jsonResponse(page([customer("C0001")], 1, 2, 2)))
      .mockResolvedValueOnce(problemResponse(500))
      .mockResolvedValueOnce(jsonResponse(page([customer("C0002")], 2, 2, 2)));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.listCustomers());

    expect(value?.items).toHaveLength(2);
    expect(
      fakeFetch.mock.calls.map((_, call) =>
        requestedUrl(fakeFetch, call).searchParams.get("pagina"),
      ),
    ).toEqual(["1", "2", "2"]);
  });
});

describe("createErpClient getCustomer (F02 / US-002, single-customer ERP lookup)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an existing customer from its own route with the API key", async () => {
    const fakeFetch = createFakeFetch().mockResolvedValueOnce(
      jsonResponse(customer("C0001")),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value, error } = await settle(client.getCustomer("C0001"));

    expect(error).toBeUndefined();
    expect(value).toEqual({ status: "found", customer: customer("C0001") });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const url = requestedUrl(fakeFetch, 0);
    expect(url.origin + url.pathname).toBe(
      "https://erp.test/v1/clientes/C0001",
    );
    expect(url.search).toBe("");
    const init = requestedInit(fakeFetch, 0);
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe(apiKey);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an unknown customer as not found after a single call", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(problemResponse(404)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value, error } = await settle(client.getCustomer("C9999"));

    expect(error).toBeUndefined();
    expect(value).toEqual({ status: "not-found" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("reports an invalid customer with its validation issues only, without retrying", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(jsonResponse(customer("C0077", { status: "SUSPENSO" }))),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value, error } = await settle(client.getCustomer("C0077"));

    expect(error).toBeUndefined();
    expect(value).toEqual({
      status: "invalid",
      issues: [
        expect.objectContaining({
          path: "status",
          message: expect.any(String),
        }),
      ],
    });
    expect(JSON.stringify(value)).not.toContain("Customer C0077");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("sends the code as a single encoded path segment", async () => {
    const fakeFetch = createFakeFetch().mockResolvedValueOnce(
      problemResponse(404),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    await settle(client.getCustomer("C 01/../x"));

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(requestedUrl(fakeFetch, 0).pathname).toBe(
      "/v1/clientes/C%2001%2F..%2Fx",
    );
  });

  it("retries a transient failure and returns the customer", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(problemResponse(503))
      .mockResolvedValueOnce(jsonResponse(customer("C0001")));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.getCustomer("C0001"));

    expect(value).toEqual({ status: "found", customer: customer("C0001") });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("retries an answer that is not JSON and returns the customer", async () => {
    const fakeFetch = createFakeFetch()
      .mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(customer("C0001")));
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value } = await settle(client.getCustomer("C0001"));

    expect(value).toEqual({ status: "found", customer: customer("C0001") });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["not JSON", () => new Response("<html>oops</html>", { status: 200 })],
    ["null", () => jsonResponse(null)],
    ["an array", () => jsonResponse([customer("C0001")])],
  ])("fails as malformed when the answer stays %s", async (_label, answer) => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(answer()),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { value, error } = await settle(client.getCustomer("C0001"));

    expect(value).toBeUndefined();
    expect(error).toMatchObject({
      name: "ErpRequestError",
      kind: "malformed",
    });
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });

  it("fails with status 401 after a single call without leaking the API key", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(problemResponse(401)),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.getCustomer("C0001"));

    expect(error).toMatchObject({ name: "ErpRequestError", status: 401 });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const exposed = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
    expect(exposed).not.toContain(apiKey);
  });

  it("surfaces the daily limit as RateLimitedError", async () => {
    const fakeFetch = createFakeFetch().mockImplementation(() =>
      Promise.resolve(problemResponse(429, { "Retry-After": "3600" })),
    );
    const client = createErpClient({ baseUrl, apiKey, fetch: fakeFetch });

    const { error } = await settle(client.getCustomer("C0001"));

    expect(error).toMatchObject({
      name: "RateLimitedError",
      retryAfterSeconds: 3_600,
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
