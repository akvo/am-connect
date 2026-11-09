import { redirect } from "next/navigation";
import { googleLoginEnabled, signIn } from "@/auth";
import { api } from "@/lib/api";

export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const r = await api(`/invitations/${encodeURIComponent(token)}`, {}, false);
  if (!r.ok) {
    return (
      <main className="mx-auto mt-24 w-full max-w-sm p-4">
        <p>This invitation is invalid, already used or expired.</p>
      </main>
    );
  }
  const { email } = await r.json();

  async function accept(form: FormData) {
    "use server";
    const res = await api(
      `/invitations/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        body: JSON.stringify({
          first_name: form.get("first_name"),
          last_name: form.get("last_name"),
          password: form.get("password"),
        }),
      },
      false,
    );
    if (!res.ok) {
      const { detail } = await res.json();
      redirect(
        `/invite/${token}?error=${encodeURIComponent(typeof detail === "string" ? detail : "Please check the form")}`,
      );
    }
    redirect("/login?notice=accepted");
  }

  async function googleLogin() {
    "use server";
    await signIn("keycloak", { redirectTo: "/" });
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Welcome to AMConnect</h1>
      <p>Set up your account for {email}.</p>
      {error && <p className="text-red-700">{error}</p>}
      <form action={accept} className="space-y-3">
        <input
          name="first_name"
          required
          placeholder="First name"
          className="w-full rounded border p-2"
        />
        <input
          name="last_name"
          required
          placeholder="Last name"
          className="w-full rounded border p-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          autoComplete="new-password"
          className="w-full rounded border p-2"
        />
        <button className="w-full rounded bg-black p-2 text-white">Create account</button>
      </form>
      {googleLoginEnabled && (
        <form action={googleLogin}>
          <button className="w-full rounded border p-2">Continue with Google instead</button>
        </form>
      )}
    </main>
  );
}
