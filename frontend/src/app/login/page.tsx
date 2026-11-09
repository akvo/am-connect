import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { googleLoginEnabled, signIn } from "@/auth";

const MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  accepted: "Your account is ready. Log in to continue.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;

  async function passwordLogin(form: FormData) {
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

  async function googleLogin() {
    "use server";
    await signIn("keycloak", { redirectTo: "/" });
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Log in to AMConnect</h1>
      {notice && <p className="text-green-700">{MESSAGES[notice]}</p>}
      {error && (
        <p className="text-red-700">{MESSAGES[error] ?? "Login failed. Please try again."}</p>
      )}
      <form action={passwordLogin} className="space-y-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          autoComplete="username"
          className="w-full rounded border p-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          autoComplete="current-password"
          className="w-full rounded border p-2"
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
