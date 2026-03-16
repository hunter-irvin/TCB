"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabasePublicConfig,
  getSupabasePublicConfigError,
  hasSupabasePublicConfig
} from "@/lib/supabase/config";

let browserClient: SupabaseClient | null = null;

export const getSupabaseBrowserConfigError = getSupabasePublicConfigError;

export const hasSupabaseBrowserConfig = hasSupabasePublicConfig;

export function getSupabaseBrowserClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getSupabasePublicConfig();

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return browserClient;
}
