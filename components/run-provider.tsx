"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { getRunBySlug, persistRunSlug, type RunDefinition, type RunSlug } from "@/lib/runs";

type RunContextValue = {
  run: RunDefinition;
};

const RunContext = createContext<RunContextValue | null>(null);

export function RunProvider({
  runSlug,
  children
}: {
  runSlug: RunSlug;
  children: ReactNode;
}) {
  const run = getRunBySlug(runSlug);

  if (!run) {
    throw new Error(`Invalid run slug: ${runSlug}`);
  }

  useEffect(() => {
    persistRunSlug(run.slug);
  }, [run.slug]);

  const value = useMemo(() => ({ run }), [run]);

  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRun() {
  const context = useContext(RunContext);

  if (!context) {
    throw new Error("useRun must be used within RunProvider");
  }

  return context;
}
