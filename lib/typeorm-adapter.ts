import { Adapter, AdapterUser, AdapterAccount, AdapterSession, VerificationToken as AdapterVerificationToken } from "next-auth/adapters";
import { DataSource } from "typeorm";
import { User } from "./entities/User";
import { Account } from "./entities/Account";
import { Session } from "./entities/Session";
import { VerificationToken } from "./entities/VerificationToken";

export function TypeORMAdapter(dataSource: DataSource): Adapter {
  const userRepo = dataSource.getRepository(User);
  const accountRepo = dataSource.getRepository(Account);
  const sessionRepo = dataSource.getRepository(Session);
  const verificationTokenRepo = dataSource.getRepository(VerificationToken);

  return {
    async createUser(user: Omit<AdapterUser, "id">): Promise<AdapterUser> {
      const newUser = userRepo.create({
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
      });
      await userRepo.save(newUser);
      return newUser as AdapterUser;
    },

    async getUser(id: string): Promise<AdapterUser | null> {
      const user = await userRepo.findOneBy({ id });
      return user as AdapterUser | null;
    },

    async getUserByEmail(email: string): Promise<AdapterUser | null> {
      const user = await userRepo.findOneBy({ email });
      return user as AdapterUser | null;
    },

    async getUserByAccount({
      providerAccountId,
      provider,
    }: {
      providerAccountId: string;
      provider: string;
    }): Promise<AdapterUser | null> {
      const account = await accountRepo.findOne({
        where: { provider, providerAccountId },
        relations: ["user"],
      });
      return (account?.user as AdapterUser) ?? null;
    },

    async updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">): Promise<AdapterUser> {
      await userRepo.update(user.id, {
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
      });
      const updatedUser = await userRepo.findOneByOrFail({ id: user.id });
      return updatedUser as AdapterUser;
    },

    async deleteUser(userId: string): Promise<void> {
      await userRepo.delete({ id: userId });
    },

    async linkAccount(account: AdapterAccount): Promise<AdapterAccount | null | undefined> {
      const newAccount = accountRepo.create({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        refresh_token: account.refresh_token,
        access_token: account.access_token,
        expires_at: account.expires_at,
        token_type: account.token_type,
        scope: account.scope,
        id_token: account.id_token,
        session_state: account.session_state,
      });
      await accountRepo.save(newAccount);
      return newAccount as AdapterAccount;
    },

    async unlinkAccount({
      providerAccountId,
      provider,
    }: {
      providerAccountId: string;
      provider: string;
    }): Promise<void> {
      await accountRepo.delete({ provider, providerAccountId });
    },

    async createSession(session: {
      sessionToken: string;
      userId: string;
      expires: Date;
    }): Promise<AdapterSession> {
      const newSession = sessionRepo.create({
        sessionToken: session.sessionToken,
        userId: session.userId,
        expires: session.expires,
      });
      await sessionRepo.save(newSession);
      return newSession as AdapterSession;
    },

    async getSessionAndUser(sessionToken: string): Promise<{ session: AdapterSession; user: AdapterUser } | null> {
      const session = await sessionRepo.findOne({
        where: { sessionToken },
        relations: ["user"],
      });

      if (!session || !session.user) return null;

      return {
        session: session as AdapterSession,
        user: session.user as AdapterUser,
      };
    },

    async updateSession(
      session: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">
    ): Promise<AdapterSession | null | undefined> {
      await sessionRepo.update(
        { sessionToken: session.sessionToken },
        {
          expires: session.expires,
          userId: session.userId,
        }
      );
      const updatedSession = await sessionRepo.findOneBy({
        sessionToken: session.sessionToken,
      });
      return (updatedSession as AdapterSession) ?? null;
    },

    async deleteSession(sessionToken: string): Promise<void> {
      await sessionRepo.delete({ sessionToken });
    },

    async createVerificationToken(token: {
      identifier: string;
      expires: Date;
      token: string;
    }): Promise<AdapterVerificationToken | null | undefined> {
      const verificationToken = verificationTokenRepo.create({
        identifier: token.identifier,
        token: token.token,
        expires: token.expires,
      });
      await verificationTokenRepo.save(verificationToken);
      return verificationToken as AdapterVerificationToken;
    },

    async useVerificationToken({
      identifier,
      token,
    }: {
      identifier: string;
      token: string;
    }): Promise<AdapterVerificationToken | null> {
      const verificationToken = await verificationTokenRepo.findOneBy({
        identifier,
        token,
      });

      if (!verificationToken) return null;

      await verificationTokenRepo.delete({ identifier, token });
      return verificationToken as AdapterVerificationToken;
    },
  };
}
