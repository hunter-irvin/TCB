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

export async function POST(request: NextRequest) {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.json(
      { error: "Matchup Tinder requires Supabase configuration." },
      { status: 500 }
    );
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
  const { error: insertError } = await supabase.from("matchup_tinder_responses").insert({
    offense_player_id: offensePlayerId,
    defense_player_id: defensePlayerId,
    result: body.result,
    mode: body.mode
  });

  if (insertError) {
    return NextResponse.json({ error: "Unable to record matchup response." }, { status: 500 });
  }

  let data = null;
  let playersError = null;
  let responseRows = [];

  try {
    [{ data, error: playersError }, responseRows] = await Promise.all([
      supabase
        .from("players")
        .select(MATCHUP_TINDER_PLAYER_SELECT_COLUMNS)
        .eq("active", true)
        .order("row_number", { ascending: true }),
      fetchAllMatchupTinderVoteRows(supabase)
    ]);
  } catch {
    return NextResponse.json(
      { ok: true, nextMatchup: null },
      { status: 200 }
    );
  }

  if (playersError) {
    return NextResponse.json(
      { ok: true, nextMatchup: null },
      { status: 200 }
    );
  }

  const seenMatchupKeys = normalizeMatchupKeyList([
    ...(body.seenMatchupKeys ?? []),
    buildMatchupKey(offensePlayerId, defensePlayerId)
  ]);
  const players = matchupTinderPlayersFromRows(data ?? []);
  const pairVoteTotals = buildMatchupPairVoteTotals(responseRows);
  const nextMatchup = buildNextMatchup(players, seenMatchupKeys, body.mode, pairVoteTotals);

  return NextResponse.json({
    ok: true,
    nextMatchup
  });
}
