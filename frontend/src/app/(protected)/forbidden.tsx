import Link from "next/link";
import type { ReactElement } from "react";

export default function Forbidden(): ReactElement {
  return (
    <main className="mx-auto mt-16 w-full max-w-md space-y-4 p-4">
      <h1 className="text-2xl font-semibold">No access</h1>
      <p>
        Your roles do not give access to this page. Ask an AMConnect administrator if you need it.
      </p>
      <Link href="/dashboard" className="underline">
        Go to the dashboard
      </Link>
    </main>
  );
}
