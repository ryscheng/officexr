import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths (including home page for anonymous access)
  if (
    pathname === "/" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Check for session using next-auth for protected routes
  const { getToken } = await import("next-auth/jwt");
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)",
  ],
};
