import type { ReactElement } from "react";
import { requireArea } from "@/lib/api";

export const instant = false; // see layout.tsx

export default async function WebGisPage(): Promise<ReactElement> {
  await requireArea("webgis");
  return (
    <main className="mx-auto mt-8 w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">WebGIS</h1>
      <p>Maps built from the datasets you can access will be here.</p>
    </main>
  );
}
