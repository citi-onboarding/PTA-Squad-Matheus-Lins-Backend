import type { Database } from "../../shared/database/create-database.js";
import type { Role } from "../../shared/database/generated/enums.js";
import { hashPassword } from "./password.js";

interface InitialUser {
  name: string;
  email: string;
  role: Role;
  sellerCode?: string;
}

/**
 * Provisional `@distrilux.test` emails until DistriLux sends the real list
 * (PRD 12.2).
 *
 * TEMPORARY (manager decision, 2026-11-26): the sellers below are invented
 * because the customer sync does not exist yet. Replace them with one SELLER
 * per distinct `Customer.sellerCode` once it does (see ADR 0004).
 */
const INITIAL_USERS: InitialUser[] = [
  {
    name: "Fernanda Cavalcanti",
    email: "fernanda.cavalcanti@distrilux.test",
    role: "MANAGER",
  },
  {
    name: "Sérgio Barros",
    email: "sergio.barros@distrilux.test",
    role: "FINANCE",
  },
  { name: "Lucas Moura", email: "lucas.moura@distrilux.test", role: "ADMIN" },
  {
    name: "Carla Nogueira",
    email: "carla.nogueira@distrilux.test",
    role: "SELLER",
    sellerCode: "MOCK-01",
  },
  {
    name: "Rafael Duarte",
    email: "rafael.duarte@distrilux.test",
    role: "SELLER",
    sellerCode: "MOCK-02",
  },
  {
    name: "Juliana Prado",
    email: "juliana.prado@distrilux.test",
    role: "SELLER",
    sellerCode: "MOCK-03",
  },
];

/**
 * Creates the initial users. Safe to run repeatedly: it upserts by email and
 * never changes an existing user, so a changed password stays changed.
 */
export async function seedInitialUsers(
  database: Database,
  initialPassword: string | undefined,
): Promise<void> {
  if (!initialPassword)
    throw new Error(
      "SEED_DEFAULT_PASSWORD must be set to seed the initial users.",
    );

  for (const user of INITIAL_USERS) {
    await database.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, passwordHash: await hashPassword(initialPassword) },
    });
  }
}
