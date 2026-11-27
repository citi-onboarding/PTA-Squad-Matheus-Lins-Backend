import { describe, expect, it } from "vitest";

import { parseEnvironment } from "./env.js";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
  CORS_ORIGINS: "http://localhost:5173, https://example.com ",
  ERP_BASE_URL: "https://pta-erp-api.onrender.com",
  ERP_API_KEY: "test-erp-key",
};

describe("parseEnvironment", () => {
  it("parses defaults and a comma-separated CORS allowlist", () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.SERVER_PORT).toBe(3001);
    expect(environment.corsOrigins).toEqual([
      "http://localhost:5173",
      "https://example.com",
    ]);
  });

  it("rejects invalid database URLs", () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DATABASE_URL: "mysql://localhost/test",
      }),
    ).toThrow();
  });

  it("exposes the ERP base URL and API key", () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.ERP_BASE_URL).toBe("https://pta-erp-api.onrender.com");
    expect(environment.ERP_API_KEY).toBe("test-erp-key");
  });

  it("rejects an ERP base URL that is not a URL", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, ERP_BASE_URL: "not-a-url" }),
    ).toThrow();
  });

  it("rejects a missing ERP API key", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, ERP_API_KEY: undefined }),
    ).toThrow();
  });

  it("rejects an empty ERP API key", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, ERP_API_KEY: "" }),
    ).toThrow();
  });

  it("trusts no proxy unless TRUST_PROXY is set", () => {
    expect(parseEnvironment(validEnvironment).TRUST_PROXY).toBe(0);
    expect(
      parseEnvironment({ ...validEnvironment, TRUST_PROXY: "1" }).TRUST_PROXY,
    ).toBe(1);
  });

  it.each(["-1", "1.5", "yes"])(
    "rejects TRUST_PROXY %s, which is not a hop count",
    (value) => {
      expect(() =>
        parseEnvironment({ ...validEnvironment, TRUST_PROXY: value }),
      ).toThrow();
    },
  );

  it("rejects an empty CORS allowlist", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, CORS_ORIGINS: " , " }),
    ).toThrow("CORS_ORIGINS must contain at least one origin.");
  });
});
