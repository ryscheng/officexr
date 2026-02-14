import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { TypeORMAdapter } from "./typeorm-adapter";
import { getDataSource } from "./db";

let cachedAdapter: ReturnType<typeof TypeORMAdapter> | undefined;

async function getAdapter() {
  if (!cachedAdapter) {
    const dataSource = await getDataSource();
    cachedAdapter = TypeORMAdapter(dataSource);
  }
  return cachedAdapter;
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const adapter = await getAdapter();

  return {
    adapter,
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      }),
    ],
    pages: {
      signIn: "/login",
    },
    callbacks: {
      async session({ session, user }) {
        if (session.user && user) {
          session.user.id = user.id;
        }
        return session;
      },
    },
    session: {
      strategy: "database",
    },
    secret: process.env.NEXTAUTH_SECRET,
  };
}
