import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACTIVE_RUN_COOKIE_KEY,
  buildRunPath,
  getStoredRunSlugFromValue
} from "@/lib/runs";

export default async function Page() {
  const cookieStore = await cookies();
  const runSlug = getStoredRunSlugFromValue(cookieStore.get(ACTIVE_RUN_COOKIE_KEY)?.value);

  redirect(buildRunPath(runSlug, "roster"));
}
