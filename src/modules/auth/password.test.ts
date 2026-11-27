import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

describe("F01 / US-001 password hashing", () => {
  it("never stores the password itself and salts every hash", async () => {
    const first = await hashPassword("correct horse");
    const second = await hashPassword("correct horse");

    expect(first).not.toBe("");
    expect(first).not.toContain("correct horse");
    expect(second).not.toBe(first);
  });

  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");

    await expect(verifyPassword("correct horse", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong horse", stored)).resolves.toBe(false);
  });

  it("rejects any password against a malformed stored hash", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
  });
});
