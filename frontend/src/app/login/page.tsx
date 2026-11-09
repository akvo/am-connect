import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { googleLoginEnabled, signIn } from "@/auth";
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
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) redirect(`/login?error=${e.type}`);
    throw e; // signIn redirects by throwing
  }
}

async function googleLogin(): Promise<void> {
  "use server";
  await signIn("keycloak", { redirectTo: "/" });
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}): Promise<ReactElement> {
  const { error, notice } = await searchParams;

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Log in to AMConnect</h1>
      {notice && <p className="text-green-700">{MESSAGES[notice]}</p>}
      {error && (
        <p className="text-red-700">{MESSAGES[error] ?? "Login failed. Please try again."}</p>
      )}
      <form action={passwordLogin} className="space-y-3">
        <Input name="email" type="email" placeholder="Email" autoComplete="username" />
        <Input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
        />
        <button className="w-full rounded bg-black p-2 text-white">Log in</button>
      </form>
      {googleLoginEnabled && (
        <form action={googleLogin}>
          <button className="w-full rounded border p-2">Continue with Google</button>
        </form>
      )}
    </main>
  );
}
