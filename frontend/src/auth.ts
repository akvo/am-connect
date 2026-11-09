import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import Keycloak from "next-auth/providers/keycloak";

const BACKEND = process.env.BACKEND_INTERNAL_URL;
const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER!; // browser URL, as written in tokens
const KEYCLOAK_INTERNAL = `${process.env.KEYCLOAK_INTERNAL_URL}/realms/amconnect/protocol/openid-connect`;

export const googleLoginEnabled = process.env.GOOGLE_LOGIN_ENABLED === "true";

type Tokens = { access_token: string; refresh_token: string; expires_in: number };

async function backend(path: string, body: unknown): Promise<Tokens | null> {
  const r = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json() : null;
}

function fromTokens(t: Tokens): Partial<JWT> {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Password login: the backend checks it with Keycloak, so no Keycloak page is shown.
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize({ email, password }) {
        const tokens = await backend("/auth/login", { email, password });
        return tokens ? { tokens } : null;
      },
    }),
    // Google login: Keycloak only redirects (kc_idp_hint), the user sees Google's page.
    Keycloak({
      clientId: "platform",
      clientSecret: process.env.PLATFORM_CLIENT_SECRET,
      issuer: KEYCLOAK_ISSUER,
      authorization: {
        url: `${KEYCLOAK_ISSUER}/protocol/openid-connect/auth`,
        params: { scope: "openid email profile", kc_idp_hint: "google" },
      },
      token: `${KEYCLOAK_INTERNAL}/token`,
      userinfo: `${KEYCLOAK_INTERNAL}/userinfo`,
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async jwt({ token, user, account }) {
      if (account?.provider === "keycloak") {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }
      if (user?.tokens) return { ...token, ...fromTokens(user.tokens) };
      if (Date.now() / 1000 < (token.expiresAt ?? 0) - 10) return token;
      const refreshed = await backend("/auth/refresh", { refresh_token: token.refreshToken });
      return refreshed ? { ...token, ...fromTokens(refreshed) } : null; // null ends the session
    },
    async session({ session, token }) {
      return { ...session, accessToken: token.accessToken };
    },
  },
  events: {
    async signOut(message) {
      if ("token" in message && message.token?.refreshToken) {
        await backend("/auth/logout", { refresh_token: message.token.refreshToken });
      }
    },
  },
});

declare module "next-auth" {
  interface Session {
    accessToken?: string;
  }
  interface User {
    tokens?: Tokens;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}
