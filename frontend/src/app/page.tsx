import Link from "next/link";
import { signOut } from "@/auth";
import { getMe, visibleLayers } from "@/lib/api";

export default async function Home() {
  const me = await getMe();
  const layers = await visibleLayers();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-2xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">AMConnect</h1>
        <form action={logout}>
          <button className="rounded border px-3 py-1">Log out</button>
        </form>
      </div>
      <section>
        <p>
          Logged in as <strong>{me.name ?? me.email}</strong> ({me.email})
        </p>
        <p>Roles: {me.roles.join(", ") || "none"}</p>
      </section>
      {me.roles.includes("user-manager") && (
        <Link href="/invite" className="inline-block rounded bg-black px-3 py-2 text-white">
          Invite a user
        </Link>
      )}
      <section>
        <h2 className="text-lg font-semibold">GeoServer layers you can see</h2>
        {typeof layers === "string" ? (
          <p>{layers}</p>
        ) : layers.length ? (
          <ul className="list-disc pl-6">
            {layers.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : (
          <p>None.</p>
        )}
      </section>
    </main>
  );
}
