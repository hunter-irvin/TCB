export const ACTIVE_RUN_STORAGE_KEY = "tcb-active-run";
export const ACTIVE_RUN_COOKIE_KEY = "tcb-active-run";
export const DEFAULT_RUN_SLUG = "TCB";

export const RUNS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "TCB",
    name: "TCB Run",
    displayOrder: 1,
    initials: "TCB"
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "SD",
    name: "SD Run",
    displayOrder: 2,
    initials: "SD"
  }
] as const;

export type RunSlug = (typeof RUNS)[number]["slug"];
export type RunPage = "roster" | "teams" | "matchup-tinder" | "matchup-visualizer";
export type RunDefinition = (typeof RUNS)[number];

const RUN_PAGE_SET = new Set<RunPage>(["roster", "teams", "matchup-tinder", "matchup-visualizer"]);
const RUN_BY_SLUG = new Map<RunSlug, RunDefinition>(RUNS.map((run) => [run.slug, run]));

export function normalizeRunSlug(value: string | null | undefined): RunSlug | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return RUN_BY_SLUG.has(normalized as RunSlug) ? (normalized as RunSlug) : null;
}

export function isRunSlug(value: string | null | undefined): value is RunSlug {
  return normalizeRunSlug(value) !== null;
}

export function getRunBySlug(runSlug: string | null | undefined): RunDefinition | null {
  const normalized = normalizeRunSlug(runSlug);
  return normalized ? RUN_BY_SLUG.get(normalized) ?? null : null;
}

export function buildRunPath(runSlug: RunSlug, page: RunPage) {
  return `/${runSlug}/${page}`;
}

export function buildRunApiPath(runSlug: RunSlug, path: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  return `/api/${runSlug}/${normalizedPath}`;
}

export function buildRunScopedStorageKey(baseKey: string, runSlug: RunSlug) {
  return `${baseKey}:${runSlug}`;
}

export function getRunPageFromPathname(pathname: string): RunPage | null {
  const segments = pathname.split("/").filter(Boolean);
  const page = segments.at(-1);
  return page && RUN_PAGE_SET.has(page as RunPage) ? (page as RunPage) : null;
}

export function getStoredRunSlug() {
  if (typeof window === "undefined") {
    return DEFAULT_RUN_SLUG as RunSlug;
  }

  return normalizeRunSlug(window.localStorage.getItem(ACTIVE_RUN_STORAGE_KEY)) ?? DEFAULT_RUN_SLUG;
}

export function getStoredRunSlugFromValue(value: string | null | undefined) {
  return normalizeRunSlug(value) ?? DEFAULT_RUN_SLUG;
}

export function persistRunSlug(runSlug: RunSlug) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACTIVE_RUN_STORAGE_KEY, runSlug);
  document.cookie = `${ACTIVE_RUN_COOKIE_KEY}=${encodeURIComponent(runSlug)}; path=/; max-age=31536000; samesite=lax`;
}
