import type { ReactElement } from "react";
import { requireArea } from "@/lib/api";

export const instant = false; // see layout.tsx

export default async function CmsPage(): Promise<ReactElement> {
  await requireArea("cms");
  return (
    <main className="mx-auto mt-8 w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">CMS</h1>
      <p>Pages and documents will be managed here.</p>
    </main>
  );
}
