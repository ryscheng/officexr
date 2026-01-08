import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { TypeORMAdapter } from "./typeorm-adapter";
import { getDataSource } from "./db";

let adapter: ReturnType<typeof TypeORMAdapter> | undefined;

async function getAdapter() {
  if (!adapter) {
    const dataSource = await getDataSource();
    adapter = TypeORMAdapter(dataSource);
  }
  return adapter;
}

export const authOptions: NextAuthOptions = {
  adapter: async () => await getAdapter(),
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
