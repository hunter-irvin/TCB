type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

export function getSupabasePublicConfigError(): string | null {
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return missing.length > 0 ? `Missing Supabase env vars: ${missing.join(", ")}` : null;
}

export function hasSupabasePublicConfig() {
  return getSupabasePublicConfigError() === null;
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const configError = getSupabasePublicConfigError();

  if (configError) {
    throw new Error(configError);
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  };
}
