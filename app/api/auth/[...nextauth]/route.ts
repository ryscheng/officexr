import { NextRequest } from "next/server";
import NextAuth from "next-auth/next";

async function handler(req: NextRequest, context: any) {
  // Lazy import to avoid build-time initialization
  const { getAuthOptions } = await import("@/lib/auth");
  const authOptions = await getAuthOptions();
  return NextAuth(req as any, context, authOptions);
}

export async function GET(req: NextRequest, context: any) {
  return handler(req, context);
}

export async function POST(req: NextRequest, context: any) {
  return handler(req, context);
}
