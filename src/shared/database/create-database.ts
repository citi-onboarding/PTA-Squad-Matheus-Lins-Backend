import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/client.js";

/**
 * Receives the connection string instead of reading the environment, so
 * importing this module never validates unrelated variables.
 */
export function createDatabase(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export type Database = ReturnType<typeof createDatabase>;
