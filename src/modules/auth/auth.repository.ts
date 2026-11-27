import type { Database } from "../../shared/database/create-database.js";
import type { Role } from "../../shared/database/generated/enums.js";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  sellerCode: string | null;
  passwordHash: string;
}

export interface StoredSession {
  id: number;
  lastSeenAt: Date;
  revokedAt: Date | null;
  user: AuthUser;
}

export interface NewSession {
  userId: number;
  tokenHash: string;
  now: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: number): Promise<AuthUser | null>;
  createSession(session: NewSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  touchSession(sessionId: number, now: Date): Promise<void>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
}

const userFields = {
  id: true,
  name: true,
  email: true,
  role: true,
  sellerCode: true,
  passwordHash: true,
} as const;

export function createPrismaAuthRepository(database: Database): AuthRepository {
  return {
    findUserByEmail: (email) =>
      database.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: userFields,
      }),
    findUserById: (id) =>
      database.user.findUnique({ where: { id }, select: userFields }),
    async createSession({ userId, tokenHash, now }) {
      await database.session.create({
        data: { userId, tokenHash, createdAt: now, lastSeenAt: now },
      });
    },
    findSessionByTokenHash: (tokenHash) =>
      database.session.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          lastSeenAt: true,
          revokedAt: true,
          user: { select: userFields },
        },
      }),
    async touchSession(sessionId, now) {
      await database.session.update({
        where: { id: sessionId },
        data: { lastSeenAt: now },
      });
    },
    async revokeSession(tokenHash, now) {
      await database.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: now },
      });
    },
  };
}
