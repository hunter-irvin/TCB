"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserConfigError(): string | null {
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return missing.length > 0 ? `Missing Supabase env vars: ${missing.join(", ")}` : null;
}

export function hasSupabaseBrowserConfig() {
  return getSupabaseBrowserConfigError() === null;
}

function getSupabaseBrowserConfig(): SupabaseBrowserConfig {
  const configError = getSupabaseBrowserConfigError();

  if (configError) {
    throw new Error(configError);
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  };
}

export function getSupabaseBrowserClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getSupabaseBrowserConfig();

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return browserClient;
}
