import { NextResponse } from "next/server";
import {
  buildMatchupVisualizerBundleResponse,
  MATCHUP_VISUALIZER_MIN_COUNT,
  matchupVisualizerNodesFromRows
} from "@/lib/matchup-visualizer";
import { getRunBySlug } from "@/lib/runs";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const PLAYER_SELECT_COLUMNS = "id,row_number,name";
const RESPONSE_SELECT_COLUMNS = "offense_player_id,defense_player_id,result";

export async function GET(
  _request: Request,
  context: { params: Promise<{ run: string }> }
) {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.json(
      { error: "Matchup Visualizer requires Supabase configuration." },
      { status: 500 }
    );
  }

  const { run: runParam } = await context.params;
  const run = getRunBySlug(runParam);

  if (!run) {
    return NextResponse.json({ error: "Invalid run." }, { status: 404 });
  }

  const supabase = getSupabaseServerClient();
  const { data: playerRows, error: playerError } = await supabase
    .from("players")
    .select(PLAYER_SELECT_COLUMNS)
    .eq("run_id", run.id)
    .order("row_number", { ascending: true });

  if (playerError) {
    return NextResponse.json({ error: "Unable to load roster players." }, { status: 500 });
  }

  const nodes = matchupVisualizerNodesFromRows(playerRows ?? []);
  const playerIds = nodes.map((player) => player.id);

  if (playerIds.length === 0) {
    return NextResponse.json(
      buildMatchupVisualizerBundleResponse([], [], MATCHUP_VISUALIZER_MIN_COUNT)
    );
  }

  const { data: responseRows, error: responseError } = await supabase
    .from("matchup_tinder_responses")
    .select(RESPONSE_SELECT_COLUMNS)
    .eq("mode", "play")
    .in("offense_player_id", playerIds)
    .in("defense_player_id", playerIds);

  if (responseError) {
    return NextResponse.json({ error: "Unable to load matchup response data." }, { status: 500 });
  }

  const payload = buildMatchupVisualizerBundleResponse(
    nodes,
    responseRows ?? [],
    MATCHUP_VISUALIZER_MIN_COUNT
  );

  return NextResponse.json(payload);
}
