export const MATCHUP_TINDER_MODES = ["test", "play"] as const;
export const MATCHUP_TINDER_RESULTS = [
  "offense_wins",
  "defense_wins",
  "good_matchup"
] as const;

export type MatchupTinderMode = (typeof MATCHUP_TINDER_MODES)[number];
export type MatchupTinderResult = (typeof MATCHUP_TINDER_RESULTS)[number];

export type MatchupTinderPlayer = {
  id: number;
  rowNumber: number;
  name: string;
};

export type MatchupTinderMatchup = {
  matchupKey: string;
  mode: MatchupTinderMode;
  offensePlayer: MatchupTinderPlayer;
  defensePlayer: MatchupTinderPlayer;
};

type DbMatchupTinderPlayerRow = {
  id: number;
  row_number: number;
  active?: boolean | null;
  name: string;
};

export function isMatchupTinderMode(value: unknown): value is MatchupTinderMode {
  return MATCHUP_TINDER_MODES.includes(value as MatchupTinderMode);
}

export function isMatchupTinderResult(value: unknown): value is MatchupTinderResult {
  return MATCHUP_TINDER_RESULTS.includes(value as MatchupTinderResult);
}

export function buildMatchupKey(offensePlayerId: number, defensePlayerId: number) {
  return `${offensePlayerId}:${defensePlayerId}`;
}

export function matchupTinderPlayersFromRows(rows: DbMatchupTinderPlayerRow[]): MatchupTinderPlayer[] {
  return rows
    .filter((row) => row.active !== false && row.name.trim().length > 0)
    .map((row) => ({
      id: row.id,
      rowNumber: row.row_number,
      name: row.name.trim()
    }))
    .sort((left, right) => left.rowNumber - right.rowNumber);
}

export function normalizeMatchupKeyList(values: Iterable<string>) {
  const keys = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!/^\d+:\d+$/.test(trimmed)) {
      continue;
    }

    keys.add(trimmed);
  }

  return [...keys];
}

function pickRandomItem<T>(items: T[]) {
  if (items.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? null;
}

export function buildNextMatchup(
  players: MatchupTinderPlayer[],
  excludedKeys: Iterable<string>,
  mode: MatchupTinderMode
): MatchupTinderMatchup | null {
  if (players.length < 2) {
    return null;
  }

  const excluded = new Set(normalizeMatchupKeyList(excludedKeys));
  const allCandidates: MatchupTinderMatchup[] = [];
  const unseenCandidates: MatchupTinderMatchup[] = [];

  for (const offensePlayer of players) {
    for (const defensePlayer of players) {
      if (offensePlayer.id === defensePlayer.id) {
        continue;
      }

      const matchupKey = buildMatchupKey(offensePlayer.id, defensePlayer.id);
      const matchup = {
        matchupKey,
        mode,
        offensePlayer,
        defensePlayer
      };

      allCandidates.push(matchup);

      if (!excluded.has(matchupKey)) {
        unseenCandidates.push(matchup);
      }
    }
  }

  return pickRandomItem(unseenCandidates.length > 0 ? unseenCandidates : allCandidates);
}
