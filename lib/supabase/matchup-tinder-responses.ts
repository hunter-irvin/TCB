import type { MatchupTinderVoteRow } from "@/lib/matchup-tinder";
import type { MatchupVisualizerResult } from "@/lib/matchup-visualizer";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MATCHUP_TINDER_RESPONSE_PAGE_SIZE = 1000;

type SupabaseServerClient = ReturnType<typeof getSupabaseServerClient>;

type MatchupTinderResponseBaseRow = {
  id: number;
  offense_player_id: number;
  defense_player_id: number;
};

type MatchupVisualizerResponseDbRow = MatchupTinderResponseBaseRow & {
  result: MatchupVisualizerResult;
};

async function fetchAllMatchupTinderResponsePages<Row extends MatchupTinderResponseBaseRow>(
  supabase: SupabaseServerClient,
  selectColumns: string,
  playerIds?: number[]
): Promise<Row[]> {
  if (playerIds && playerIds.length === 0) {
    return [];
  }

  const rows: Row[] = [];

  for (let from = 0; ; from += MATCHUP_TINDER_RESPONSE_PAGE_SIZE) {
    let query = supabase
      .from("matchup_tinder_responses")
      .select(selectColumns)
      .eq("mode", "play")
      .order("id", { ascending: true })
      .range(from, from + MATCHUP_TINDER_RESPONSE_PAGE_SIZE - 1);

    if (playerIds) {
      query = query.in("offense_player_id", playerIds).in("defense_player_id", playerIds);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    const pageRows = (data ?? []) as unknown as Row[];
    rows.push(...pageRows);

    if (pageRows.length < MATCHUP_TINDER_RESPONSE_PAGE_SIZE) {
      return rows;
    }
  }
}

export async function fetchAllMatchupTinderVoteRows(
  supabase: SupabaseServerClient,
  playerIds?: number[]
): Promise<MatchupTinderVoteRow[]> {
  const rows = await fetchAllMatchupTinderResponsePages<MatchupTinderResponseBaseRow>(
    supabase,
    "id,offense_player_id,defense_player_id",
    playerIds
  );

  return rows.map(({ id: _id, ...row }) => row);
}

export async function fetchAllMatchupVisualizerResponseRows(
  supabase: SupabaseServerClient,
  playerIds?: number[]
): Promise<
  Array<{
    offense_player_id: number;
    defense_player_id: number;
    result: MatchupVisualizerResult;
  }>
> {
  const rows = await fetchAllMatchupTinderResponsePages<MatchupVisualizerResponseDbRow>(
    supabase,
    "id,offense_player_id,defense_player_id,result",
    playerIds
  );

  return rows.map(({ id: _id, ...row }) => row);
}
