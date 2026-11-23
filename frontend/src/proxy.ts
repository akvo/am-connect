import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Pages anyone may open; every other page needs a session.
const PUBLIC = /^\/(login|invite\/[^/]+)?$/;
// The page asked for, so a session the backend refuses can return here after login (api.ts)
export const RETURN_TO = "x-return-to";

// Runs auth() where it can set cookies: refreshed tokens from server components are dropped.
export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;
  // form submits (server actions) can't follow a redirect; the page sends them to login itself
  if (req.auth || PUBLIC.test(pathname) || req.headers.has("next-action")) {
    const headers = new Headers(req.headers); // set here, so a client can't choose it
    headers.set(RETURN_TO, pathname + search);
    return NextResponse.next({ request: { headers } });
  }
  const login = new URL("/login", req.nextUrl);
  login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
