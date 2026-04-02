import { NextResponse } from "next/server";
import {
  buildMatchupVisualizerBundleResponse,
  MATCHUP_VISUALIZER_MIN_COUNT,
  matchupVisualizerNodesFromRows
} from "@/lib/matchup-visualizer";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { fetchAllMatchupVisualizerResponseRows } from "@/lib/supabase/matchup-tinder-responses";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const PLAYER_SELECT_COLUMNS = "id,row_number,active,name";

export async function GET() {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.json(
      { error: "Matchup Visualizer requires Supabase configuration." },
      { status: 500 }
    );
  }

  const supabase = getSupabaseServerClient();

  let playerRows = null;
  let playerError = null;
  let responseRows = [];

  try {
    [{ data: playerRows, error: playerError }, responseRows] = await Promise.all([
      supabase
        .from("players")
        .select(PLAYER_SELECT_COLUMNS)
        .eq("active", true)
        .order("row_number", { ascending: true }),
      fetchAllMatchupVisualizerResponseRows(supabase)
    ]);
  } catch {
    return NextResponse.json({ error: "Unable to load matchup response data." }, { status: 500 });
  }

  if (playerError) {
    return NextResponse.json({ error: "Unable to load roster players." }, { status: 500 });
  }

  const nodes = matchupVisualizerNodesFromRows(playerRows ?? []);
  const payload = buildMatchupVisualizerBundleResponse(
    nodes,
    responseRows,
    MATCHUP_VISUALIZER_MIN_COUNT
  );

  return NextResponse.json(payload);
}
