import { redirect } from "next/navigation";
import { normalizeRunSlug, buildRunPath } from "@/lib/runs";

export default async function RunIndexPage({
  params
}: {
  params: Promise<{ run: string }>;
}) {
  const { run } = await params;
  const runSlug = normalizeRunSlug(run);

  redirect(buildRunPath(runSlug ?? "TCB", "roster"));
}
