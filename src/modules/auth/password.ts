import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>;

const SCHEME = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Returns `scrypt$<salt base64>$<key base64>` with a random salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KEY_BYTES);
  return [SCHEME, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Compares in constant time; a malformed stored hash never matches. */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [scheme, saltText, keyText, ...rest] = storedHash.split("$");
  if (scheme !== SCHEME || !saltText || !keyText || rest.length > 0)
    return false;
  const expected = Buffer.from(keyText, "base64");
  if (expected.length !== KEY_BYTES) return false;
  const actual = await deriveKey(
    password,
    Buffer.from(saltText, "base64"),
    KEY_BYTES,
  );
  return timingSafeEqual(actual, expected);
}
