import Link from "next/link";
import { type ReactElement, Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";

// Session-dependent, so streamed in while the rest of the page is prerendered.
async function AccountLink(): Promise<ReactElement> {
  await connection(); // auth() draws random values, which a prerender must not
  const session = await auth();
  return session ? <HeaderLink href="/dashboard" label="Dashboard" /> : <LoginLink />;
}

function HeaderLink({ href, label }: { href: string; label: string }): ReactElement {
  return (
    <Link href={href} className="rounded bg-primary px-3 py-1 text-white hover:bg-primary-hover">
      {label}
    </Link>
  );
}

const LoginLink = (): ReactElement => <HeaderLink href="/login" label="Log in" />;

export default function Landing(): ReactElement {
  return (
    <>
      <header className="flex items-center justify-between border-b p-4">
        <span className="font-semibold">AMConnect</span>
        <Suspense fallback={<LoginLink />}>
          <AccountLink />
        </Suspense>
      </header>
      <main className="mx-auto mt-16 w-full max-w-2xl space-y-4 p-4">
        <h1 className="text-3xl font-semibold">AMConnect</h1>
        <p>ASEAN minerals information, maps and cooperation in one place.</p>
      </main>
    </>
  );
}
