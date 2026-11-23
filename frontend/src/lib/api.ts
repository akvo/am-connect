import { headers as requestHeaders } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { RETURN_TO } from "@/proxy";

const BACKEND = process.env.BACKEND_INTERNAL_URL;

/** Platform areas; the backend decides which roles open each. */
export type Area = "cms" | "users" | "webgis";

export type Me = {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  grantable_roles: string[];
  areas: Area[];
  role_labels: Record<string, string>;
};

/** To login, then back to the page asked for. */
async function toLogin(): Promise<never> {
  const page = (await requestHeaders()).get(RETURN_TO);
  redirect(page ? `/login?${new URLSearchParams({ callbackUrl: page })}` : "/login");
}

/** Calls the backend; with `asUser`, sends the signed-in user's token (or goes to /login). */
export async function api(path: string, init: RequestInit = {}, asUser = true): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (asUser) {
    const session = await auth();
    if (!session?.accessToken) return toLogin();
    headers.set("authorization", `Bearer ${session.accessToken}`);
  }
  return fetch(`${BACKEND}${path}`, { ...init, headers, cache: "no-store" });
}

/** The signed-in user, fetched once per request (the layout and the page both ask). */
export const getMe = cache(async (): Promise<Me> => {
  const r = await api("/me");
  if (r.status === 401) return toLogin();
  return r.json();
});

/** Page guard: shows the 403 page unless the user's roles open `area`. */
export async function requireArea(area: Area): Promise<Me> {
  const me = await getMe();
  if (!me.areas.includes(area)) forbidden();
  return me;
}

/** Layer names the user may read; GeoServer checks the Keycloak token itself. */
export async function visibleLayers(): Promise<string[] | string> {
  const session = await auth();
  const r = await fetch(
    `${process.env.GEOSERVER_INTERNAL_URL}/amconnect/wms?service=WMS&request=GetCapabilities`,
    { headers: { authorization: `Bearer ${session?.accessToken}` }, cache: "no-store" },
  );
  if (!r.ok) return `GeoServer refused (HTTP ${r.status})`;
  const xml = await r.text();
  return [...xml.matchAll(/<Layer queryable[^>]*>\s*<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
}
