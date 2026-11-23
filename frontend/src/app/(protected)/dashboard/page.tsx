import type { ReactElement } from "react";
import { getMe, visibleLayers } from "@/lib/api";

export const instant = false; // see layout.tsx

export default async function Dashboard(): Promise<ReactElement> {
  const me = await getMe();
  const layers = await visibleLayers();

  return (
    <main className="mx-auto mt-8 w-full max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <section>
        <p>
          Logged in as <strong>{me.name ?? me.email}</strong> ({me.email})
        </p>
        <p>Roles: {me.roles.map((r) => me.role_labels[r] ?? r).join(", ") || "none"}</p>
      </section>
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
