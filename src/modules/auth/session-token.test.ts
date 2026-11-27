import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createSessionToken, hashSessionToken } from "./session-token.js";

describe("F01 / US-001 session tokens", () => {
  it("creates distinct tokens of 32 random bytes", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(second).not.toBe(first);
  });

  it("hashes a token with SHA-256", () => {
    const token = createSessionToken();

    expect(hashSessionToken(token)).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
  });
});
