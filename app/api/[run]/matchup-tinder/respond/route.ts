import { NextRequest, NextResponse } from "next/server";
import {
  buildMatchupKey,
  buildMatchupPairVoteTotals,
  buildNextMatchup,
  isMatchupTinderMode,
  isMatchupTinderResult,
  matchupTinderPlayersFromRows,
  normalizeMatchupKeyList
} from "@/lib/matchup-tinder";
import { getRunBySlug } from "@/lib/runs";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { fetchAllMatchupTinderVoteRows } from "@/lib/supabase/matchup-tinder-responses";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MATCHUP_TINDER_PLAYER_SELECT_COLUMNS = "id,row_number,active,name";

type MatchupTinderRespondRequest = {
  offensePlayerId?: number;
  defensePlayerId?: number;
  result?: string;
  mode?: string;
  seenMatchupKeys?: string[];
};

export async function POST(
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

  const body = (await request.json()) as MatchupTinderRespondRequest;
  const offensePlayerId = Number(body.offensePlayerId);
  const defensePlayerId = Number(body.defensePlayerId);

  if (!Number.isInteger(offensePlayerId) || !Number.isInteger(defensePlayerId)) {
    return NextResponse.json({ error: "Invalid player IDs." }, { status: 400 });
  }

  if (offensePlayerId === defensePlayerId) {
    return NextResponse.json({ error: "Offense and defense must be different players." }, { status: 400 });
  }

  if (!isMatchupTinderMode(body.mode)) {
    return NextResponse.json({ error: "Invalid matchup mode." }, { status: 400 });
  }

  if (!isMatchupTinderResult(body.result)) {
    return NextResponse.json({ error: "Invalid matchup result." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: selectedPlayers, error: selectedPlayersError } = await supabase
    .from("players")
    .select(MATCHUP_TINDER_PLAYER_SELECT_COLUMNS)
    .eq("run_id", run.id)
    .in("id", [offensePlayerId, defensePlayerId]);

  if (selectedPlayersError) {
    return NextResponse.json({ error: "Unable to verify matchup players." }, { status: 500 });
  }

  if ((selectedPlayers ?? []).length !== 2) {
    return NextResponse.json({ error: "Selected players do not belong to this run." }, { status: 400 });
  }

  const { error: insertError } = await supabase.from("matchup_tinder_responses").insert({
    offense_player_id: offensePlayerId,
    defense_player_id: defensePlayerId,
    result: body.result,
    mode: body.mode
  });

  if (insertError) {
    return NextResponse.json({ error: "Unable to record matchup response." }, { status: 500 });
  }

  const { data, error: playersError } = await supabase
    .from("players")
    .select(MATCHUP_TINDER_PLAYER_SELECT_COLUMNS)
    .eq("run_id", run.id)
    .eq("active", true)
    .order("row_number", { ascending: true });

  if (playersError) {
    return NextResponse.json(
      { ok: true, nextMatchup: null },
      { status: 200 }
    );
  }

  const players = matchupTinderPlayersFromRows(data ?? []);
  const playerIds = players.map((player) => player.id);

  let responseRows = [];

  try {
    responseRows = await fetchAllMatchupTinderVoteRows(supabase, playerIds);
  } catch {
    return NextResponse.json(
      { ok: true, nextMatchup: null },
      { status: 200 }
    );
  }

  const seenMatchupKeys = normalizeMatchupKeyList([
    ...(body.seenMatchupKeys ?? []),
    buildMatchupKey(offensePlayerId, defensePlayerId)
  ]);
  const pairVoteTotals = buildMatchupPairVoteTotals(responseRows);
  const nextMatchup = buildNextMatchup(players, seenMatchupKeys, body.mode, pairVoteTotals);

  return NextResponse.json({
    ok: true,
    nextMatchup
  });
}
