import { seedInitialUsers } from "../src/modules/auth/seed-initial-users.js";
import { env } from "../src/shared/config/env.js";
import { createDatabase } from "../src/shared/database/create-database.js";

const database = createDatabase(env.DATABASE_URL);

try {
  // Fails before writing anything when SEED_DEFAULT_PASSWORD is missing.
  await seedInitialUsers(database, process.env.SEED_DEFAULT_PASSWORD);
} finally {
  await database.$disconnect();
}
