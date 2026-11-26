import { env } from "../src/shared/config/env.js";
import { createDatabase } from "../src/shared/database/create-database.js";

const database = createDatabase(env.DATABASE_URL);

try {
  // Add idempotent project seeds in this block.
} finally {
  await database.$disconnect();
}
