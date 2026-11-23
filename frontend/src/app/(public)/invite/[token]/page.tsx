import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { loginProviders, signInWith } from "@/auth";
import { api } from "@/lib/api";
import { Input } from "@/components/input";

async function accept(token: string, form: FormData): Promise<void> {
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

async function idpLogin(idp: string): Promise<void> {
  "use server";
  await signInWith(idp);
}

export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactElement> {
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

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Welcome to AMConnect</h1>
      <p>Set up your account for {email}.</p>
      {error && <p className="text-red-700">{error}</p>}
      <form action={accept.bind(null, token)} className="space-y-3">
        <Input name="first_name" placeholder="First name" />
        <Input name="last_name" placeholder="Last name" />
        <Input name="password" type="password" placeholder="Password" autoComplete="new-password" />
        <button className="w-full rounded bg-primary p-2 text-white hover:bg-primary-hover">
          Create account
        </button>
      </form>
      {loginProviders.map(({ idp, label }) => (
        <form key={idp} action={idpLogin.bind(null, idp)}>
          <button className="w-full rounded border p-2">Continue with {label} instead</button>
        </form>
      ))}
    </main>
  );
}
