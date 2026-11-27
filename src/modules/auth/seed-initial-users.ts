import type { Database } from "../../shared/database/create-database.js";
import type { Role } from "../../shared/database/generated/enums.js";
import { hashPassword } from "./password.js";

interface InitialUser {
  name: string;
  email: string;
  role: Role;
  sellerCode?: string;
}

/** Provisional domain until DistriLux sends the real list (PRD 12.2). */
const EMAIL_DOMAIN = "distrilux.test";

const FIXED_USERS: InitialUser[] = [
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
];

/** `Patrícia Lins` → `patricia.lins@distrilux.test`. */
function sellerEmail(name: string): string {
  const localPart = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${localPart}@${EMAIL_DOMAIN}`;
}

/**
 * One SELLER per distinct seller of the stored customers. The ERP identifies a
 * customer's seller by name, so the name is also the seller code.
 */
async function sellersFromCustomers(
  database: Database,
): Promise<InitialUser[]> {
  const customers = await database.customer.findMany({
    distinct: ["sellerCode"],
    select: { sellerCode: true },
    orderBy: { sellerCode: "asc" },
  });
  return customers.map(({ sellerCode }) => ({
    name: sellerCode,
    email: sellerEmail(sellerCode),
    role: "SELLER",
    sellerCode,
  }));
}

/**
 * Creates the initial users: the fixed MANAGER, FINANCE, and ADMIN users and
 * one SELLER per seller of the synced customers. Safe to run repeatedly: it
 * upserts by email and never changes an existing user, so a changed password
 * stays changed, and sellers of newly synced customers are added.
 */
export async function seedInitialUsers(
  database: Database,
  initialPassword: string | undefined,
): Promise<void> {
  if (!initialPassword)
    throw new Error(
      "SEED_DEFAULT_PASSWORD must be set to seed the initial users.",
    );

  const sellers = await sellersFromCustomers(database);
  if (sellers.length === 0)
    throw new Error(
      "No sellers to create: no customer is stored. Run pnpm sync:erp before pnpm db:seed. No user was created.",
    );

  for (const user of [...FIXED_USERS, ...sellers]) {
    await database.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, passwordHash: await hashPassword(initialPassword) },
    });
  }
}
