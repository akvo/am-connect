import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { signOut } from "@/auth";
import { type Area, getMe } from "@/lib/api";

// Shown only when the user's areas include `area`; the backend decides those.
const LINKS: { href: string; label: string; area?: Area }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/cms", label: "CMS", area: "cms" },
  { href: "/webgis", label: "WebGIS", area: "webgis" },
  { href: "/users", label: "Users", area: "users" },
];

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

// Nothing here can render before the session is checked, and a 403 needs its status code.
export const instant = false;

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const me = await getMe();
  return (
    <>
      <header className="flex items-center gap-4 border-b p-4">
        <Link href="/dashboard" className="font-semibold">
          AMConnect
        </Link>
        <nav className="flex flex-1 gap-4">
          {LINKS.filter((l) => !l.area || me.areas.includes(l.area)).map((l) => (
            <Link key={l.href} href={l.href} className="underline-offset-4 hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <span>{me.name ?? me.email}</span>
        <form action={logout}>
          <button className="rounded border px-3 py-1">Log out</button>
        </form>
      </header>
      {children}
    </>
  );
}
