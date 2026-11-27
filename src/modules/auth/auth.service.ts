import type { Role } from "../../shared/database/generated/enums.js";
import type { AuthenticatedUser } from "../../shared/http/require-auth.js";
import type { AuthRepository, AuthUser } from "./auth.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSessionToken, hashSessionToken } from "./session-token.js";

/** A session ends after 8 hours without any authenticated request. */
export const SESSION_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResult {
  token: string;
  user: PublicUser;
}

interface AuthServiceDependencies {
  repository: AuthRepository;
  now?: () => Date;
}

function toPublicUser({ id, name, email, role }: AuthUser): PublicUser {
  return { id, name, email, role };
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly now: () => Date;
  /** Verified against for unknown emails, so timing does not reveal them. */
  private dummyHash: Promise<string> | undefined;

  constructor({ repository, now = () => new Date() }: AuthServiceDependencies) {
    this.repository = repository;
    this.now = now;
  }

  async login(email: string, password: string): Promise<LoginResult | null> {
    const user = await this.repository.findUserByEmail(
      email.trim().toLowerCase(),
    );
    if (!user) {
      this.dummyHash ??= hashPassword(createSessionToken());
      await verifyPassword(password, await this.dummyHash);
      return null;
    }
    if (!(await verifyPassword(password, user.passwordHash))) return null;

    const token = createSessionToken();
    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      now: this.now(),
    });
    return { token, user: toPublicUser(user) };
  }

  async logout(token: string): Promise<void> {
    await this.repository.revokeSession(hashSessionToken(token), this.now());
  }

  async authenticate(token: string): Promise<AuthenticatedUser | null> {
    const session = await this.repository.findSessionByTokenHash(
      hashSessionToken(token),
    );
    if (!session || session.revokedAt) return null;
    const now = this.now();
    if (now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MS)
      return null;

    await this.repository.touchSession(session.id, now);
    const { id, role, sellerCode } = session.user;
    return { id, role, sellerCode };
  }

  async getProfile(userId: number): Promise<PublicUser | null> {
    const user = await this.repository.findUserById(userId);
    return user ? toPublicUser(user) : null;
  }
}
