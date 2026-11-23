import Link from "next/link";
import type { ReactElement } from "react";
import { api, requireArea } from "@/lib/api";

type ManagedUser = {
  id: string;
  email: string | null;
  name: string | null;
  roles: string[];
  enabled: boolean;
};

export const instant = false; // see layout.tsx

export default async function UsersPage(): Promise<ReactElement> {
  const me = await requireArea("users");
  const r = await api("/users");
  if (!r.ok) throw new Error(`Listing users failed (HTTP ${r.status})`);
  const users: ManagedUser[] = await r.json();
  return (
    <main className="mx-auto mt-8 w-full max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Link
          href="/users/invite"
          className="rounded bg-primary px-3 py-2 text-white hover:bg-primary-hover"
        >
          Invite a user
        </Link>
      </div>
      {users.length ? (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b">
              <th className="p-2">Name</th>
              <th className="p-2">Email</th>
              <th className="p-2">Roles</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="p-2">{u.name ?? "–"}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2">{u.roles.map((r) => me.role_labels[r] ?? r).join(", ")}</td>
                <td className="p-2">{u.enabled ? "Active" : "Suspended"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No users you manage yet.</p>
      )}
    </main>
  );
}
