import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { RunProvider } from "@/components/run-provider";
import { normalizeRunSlug } from "@/lib/runs";

export default async function RunLayout({
  children,
  params
}: Readonly<{
  children: ReactNode;
  params: Promise<{ run: string }>;
}>) {
  const { run } = await params;
  const runSlug = normalizeRunSlug(run);

  if (!runSlug) {
    notFound();
  }

  return <RunProvider runSlug={runSlug}>{children}</RunProvider>;
}
