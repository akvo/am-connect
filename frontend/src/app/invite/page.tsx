import Link from "next/link";
import { redirect } from "next/navigation";
import { api, getMe } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  "ckan-access": "Can log in to CKAN",
  "geoserver-access": "Can read restricted GeoServer layers",
  "user-manager": "Can invite users",
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const me = await getMe();
  if (!me.roles.includes("user-manager")) redirect("/");

  async function invite(form: FormData) {
    "use server";
    const email = String(form.get("email"));
    const r = await api("/invitations", {
      method: "POST",
      body: JSON.stringify({ email, roles: form.getAll("roles") }),
    });
    if (!r.ok) {
      const { detail } = await r.json();
      redirect(
        `/invite?error=${encodeURIComponent(typeof detail === "string" ? detail : "Invalid input")}`,
      );
    }
    redirect(`/invite?sent=${encodeURIComponent(email)}`);
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-md space-y-6 p-4">
      <Link href="/" className="underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Invite a user</h1>
      {sent && <p className="text-green-700">Invitation sent to {sent}.</p>}
      {error && <p className="text-red-700">{error}</p>}
      <form action={invite} className="space-y-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="w-full rounded border p-2"
        />
        <fieldset className="space-y-1">
          <legend className="font-medium">Access</legend>
          {me.grantable_roles.map((role) => (
            <label key={role} className="flex gap-2">
              <input type="checkbox" name="roles" value={role} />
              {ROLE_LABELS[role] ?? role}
            </label>
          ))}
        </fieldset>
        <button className="w-full rounded bg-black p-2 text-white">Send invitation</button>
      </form>
    </main>
  );
}
