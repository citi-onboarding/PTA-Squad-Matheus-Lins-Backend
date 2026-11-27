import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** 32 random bytes, base64url-encoded, sent as `Authorization: Bearer`. */
export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The only form of the token the database ever stores. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
