import { NextRequest, NextResponse } from "next/server";
import {
  buildNextMatchup,
  isMatchupTinderMode,
  matchupTinderPlayersFromRows,
  normalizeMatchupKeyList
} from "@/lib/matchup-tinder";
import { getRunBySlug } from "@/lib/runs";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MATCHUP_TINDER_PLAYER_SELECT_COLUMNS = "id,row_number,active,name";

function getExcludeKeys(searchParams: URLSearchParams) {
  return normalizeMatchupKeyList(
    searchParams
      .getAll("exclude")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ run: string }> }
) {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.json(
      { error: "Matchup Tinder requires Supabase configuration." },
      { status: 500 }
    );
  }

  const { run: runParam } = await context.params;
  const run = getRunBySlug(runParam);

  if (!run) {
    return NextResponse.json({ error: "Invalid run." }, { status: 404 });
  }

  const modeParam = request.nextUrl.searchParams.get("mode") ?? "test";
  if (!isMatchupTinderMode(modeParam)) {
    return NextResponse.json({ error: "Invalid matchup mode." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("players")
    .select(MATCHUP_TINDER_PLAYER_SELECT_COLUMNS)
    .eq("run_id", run.id)
    .eq("active", true)
    .order("row_number", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Unable to load roster players." }, { status: 500 });
  }

  const players = matchupTinderPlayersFromRows(data ?? []);
  const matchup = buildNextMatchup(players, getExcludeKeys(request.nextUrl.searchParams), modeParam);

  if (!matchup) {
    return NextResponse.json(
      { error: "Matchup Tinder needs at least two named players in the roster." },
      { status: 409 }
    );
  }

  return NextResponse.json({ matchup });
}
