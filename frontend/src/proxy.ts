// Runs auth() where it can set cookies: refreshed tokens from server components are dropped.
export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
