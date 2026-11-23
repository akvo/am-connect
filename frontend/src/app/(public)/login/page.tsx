import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { afterLogin, loginProviders, signIn, signInWith } from "@/auth";
import { Input } from "@/components/input";

const MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  accepted: "Your account is ready. Log in to continue.",
};

async function passwordLogin(form: FormData): Promise<void> {
  "use server";
  try {
    await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirectTo: afterLogin(form.get("callbackUrl")),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const back = new URLSearchParams({ error: e.type });
      const callbackUrl = form.get("callbackUrl");
      if (typeof callbackUrl === "string" && callbackUrl) back.set("callbackUrl", callbackUrl);
      redirect(`/login?${back}`);
    }
    throw e; // signIn redirects by throwing
  }
}

async function idpLogin(idp: string, callbackUrl?: string): Promise<void> {
  "use server";
  await signInWith(idp, callbackUrl);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; callbackUrl?: string }>;
}): Promise<ReactElement> {
  const { error, notice, callbackUrl } = await searchParams;

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Log in to AMConnect</h1>
      {notice && <p className="text-green-700">{MESSAGES[notice]}</p>}
      {error && (
        <p className="text-red-700">{MESSAGES[error] ?? "Login failed. Please try again."}</p>
      )}
      <form action={passwordLogin} className="space-y-3">
        <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />
        <Input name="email" type="email" placeholder="Email" autoComplete="username" />
        <Input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
        />
        <button className="w-full rounded bg-primary p-2 text-white hover:bg-primary-hover">
          Log in
        </button>
      </form>
      {loginProviders.map(({ idp, label }) => (
        <form key={idp} action={idpLogin.bind(null, idp, callbackUrl)}>
          <button className="w-full rounded border p-2">Continue with {label}</button>
        </form>
      ))}
    </main>
  );
}
