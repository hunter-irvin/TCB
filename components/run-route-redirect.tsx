"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { buildRunPath, getStoredRunSlug, type RunPage } from "@/lib/runs";

export function RunRouteRedirect({ page }: { page: RunPage }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(buildRunPath(getStoredRunSlug(), page));
  }, [page, router]);

  return (
    <main className="shell">
      <div className="page-frame">
        <section className="panel run-redirect-card" aria-live="polite">
          <h1 className="page-title">Redirecting...</h1>
          <p className="page-copy">Loading your most recent run.</p>
        </section>
      </div>
    </main>
  );
}
