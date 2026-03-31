import { NextResponse } from "next/server";
import {
  buildMatchupVisualizerBundleResponse,
  MATCHUP_VISUALIZER_MIN_COUNT,
  matchupVisualizerNodesFromRows
} from "@/lib/matchup-visualizer";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const PLAYER_SELECT_COLUMNS = "id,row_number,active,name";
const RESPONSE_SELECT_COLUMNS = "offense_player_id,defense_player_id,result";

export async function GET() {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.json(
      { error: "Matchup Visualizer requires Supabase configuration." },
      { status: 500 }
    );
  }

  const supabase = getSupabaseServerClient();

  const [{ data: playerRows, error: playerError }, { data: responseRows, error: responseError }] =
    await Promise.all([
      supabase
        .from("players")
        .select(PLAYER_SELECT_COLUMNS)
        .eq("active", true)
        .order("row_number", { ascending: true }),
      supabase
        .from("matchup_tinder_responses")
        .select(RESPONSE_SELECT_COLUMNS)
        .eq("mode", "play")
    ]);

  if (playerError) {
    return NextResponse.json({ error: "Unable to load roster players." }, { status: 500 });
  }

  if (responseError) {
    return NextResponse.json({ error: "Unable to load matchup response data." }, { status: 500 });
  }

  const nodes = matchupVisualizerNodesFromRows(playerRows ?? []);
  const payload = buildMatchupVisualizerBundleResponse(
    nodes,
    responseRows ?? [],
    MATCHUP_VISUALIZER_MIN_COUNT
  );

  return NextResponse.json(payload);
}
