import { redirect } from "next/navigation";
import { auth } from "@/auth";

const BACKEND = process.env.BACKEND_INTERNAL_URL;

export type Me = {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  grantable_roles: string[];
};

/** Calls the backend; with `asUser`, sends the signed-in user's token (or goes to /login). */
export async function api(path: string, init: RequestInit = {}, asUser = true) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (asUser) {
    const session = await auth();
    if (!session?.accessToken) redirect("/login");
    headers.set("authorization", `Bearer ${session.accessToken}`);
  }
  return fetch(`${BACKEND}${path}`, { ...init, headers, cache: "no-store" });
}

export async function getMe(): Promise<Me> {
  const r = await api("/me");
  if (r.status === 401) redirect("/login");
  return r.json();
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
