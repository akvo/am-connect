import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { api, requireArea } from "@/lib/api";
import { Input } from "@/components/input";

async function invite(form: FormData): Promise<void> {
  "use server";
  const email = String(form.get("email"));
  const r = await api("/invitations", {
    method: "POST",
    body: JSON.stringify({ email, roles: form.getAll("roles") }),
  });
  if (!r.ok) {
    const { detail } = await r.json();
    redirect(
      `/users/invite?error=${encodeURIComponent(typeof detail === "string" ? detail : "Invalid input")}`,
    );
  }
  redirect(`/users/invite?sent=${encodeURIComponent(email)}`);
}

export const instant = false; // see layout.tsx

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}): Promise<ReactElement> {
  const { sent, error } = await searchParams;
  const me = await requireArea("users");

  return (
    <main className="mx-auto mt-16 w-full max-w-md space-y-6 p-4">
      <Link href="/users" className="underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Invite a user</h1>
      {sent && <p className="text-green-700">Invitation sent to {sent}.</p>}
      {error && <p className="text-red-700">{error}</p>}
      <form action={invite} className="space-y-3">
        <Input name="email" type="email" placeholder="Email" />
        <fieldset className="space-y-1">
          <legend className="font-medium">Access</legend>
          {me.grantable_roles.map((role) => (
            <label key={role} className="flex gap-2">
              <input type="checkbox" name="roles" value={role} />
              {me.role_labels[role] ?? role}
            </label>
          ))}
        </fieldset>
        <button className="w-full rounded bg-primary p-2 text-white hover:bg-primary-hover">
          Send invitation
        </button>
      </form>
    </main>
  );
}
