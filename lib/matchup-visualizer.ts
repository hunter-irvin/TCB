export const MATCHUP_VISUALIZER_PERSPECTIVES = ["offense", "defense"] as const;
export const MATCHUP_VISUALIZER_MIN_COUNT = 1;

export type MatchupVisualizerPerspective = (typeof MATCHUP_VISUALIZER_PERSPECTIVES)[number];

export type MatchupVisualizerNode = {
  id: number;
  rowNumber: number;
  name: string;
};

export type MatchupVisualizerEdge = {
  sourcePlayerId: number;
  targetPlayerId: number;
  count: number;
};

export type MatchupVisualizerResponse = {
  perspective: MatchupVisualizerPerspective;
  minCount: number;
  nodes: MatchupVisualizerNode[];
  matrix: number[][];
  edges: MatchupVisualizerEdge[];
  maxCount: number;
  totalConnections: number;
};

type PlayerRow = {
  id: number;
  row_number: number;
  name: string;
};

type MatchupVisualizerCountRow = {
  offense_player_id: number;
  defense_player_id: number;
};

export function isMatchupVisualizerPerspective(
  value: unknown
): value is MatchupVisualizerPerspective {
  return MATCHUP_VISUALIZER_PERSPECTIVES.includes(value as MatchupVisualizerPerspective);
}

export function matchupVisualizerNodesFromRows(rows: PlayerRow[]): MatchupVisualizerNode[] {
  return rows
    .filter((row) => row.name.trim().length > 0)
    .map((row) => ({
      id: row.id,
      rowNumber: row.row_number,
      name: row.name.trim()
    }))
    .sort((left, right) => left.rowNumber - right.rowNumber);
}

export function abbreviateVisualizerName(name: string) {
  const compact = name.trim().replace(/\s+/g, " ");

  if (compact.length <= 12) {
    return compact;
  }

  const parts = compact.split(" ");
  if (parts.length < 2) {
    return compact.slice(0, 12);
  }

  const lastName = parts[parts.length - 1];
  const firstNames = parts.slice(0, -1).join(" ");
  return `${firstNames} ${lastName.charAt(0)}.`;
}

export function buildMatchupVisualizerResponse(
  players: MatchupVisualizerNode[],
  rows: MatchupVisualizerCountRow[],
  perspective: MatchupVisualizerPerspective,
  minCount: number = MATCHUP_VISUALIZER_MIN_COUNT
): MatchupVisualizerResponse {
  const indexByPlayerId = new Map(players.map((player, index) => [player.id, index] as const));
  const matrix = players.map(() => players.map(() => 0));
  const countsByPair = new Map<string, number>();

  for (const row of rows) {
    const offensePlayerId = row.offense_player_id;
    const defensePlayerId = row.defense_player_id;

    if (offensePlayerId === defensePlayerId) {
      continue;
    }

    const sourcePlayerId = perspective === "offense" ? offensePlayerId : defensePlayerId;
    const targetPlayerId = perspective === "offense" ? defensePlayerId : offensePlayerId;

    if (!indexByPlayerId.has(sourcePlayerId) || !indexByPlayerId.has(targetPlayerId)) {
      continue;
    }

    const key = `${sourcePlayerId}:${targetPlayerId}`;
    countsByPair.set(key, (countsByPair.get(key) ?? 0) + 1);
  }

  const edges: MatchupVisualizerEdge[] = [];
  let maxCount = 0;

  for (const [key, count] of countsByPair.entries()) {
    if (count < minCount) {
      continue;
    }

    const [sourcePlayerIdText, targetPlayerIdText] = key.split(":");
    const sourcePlayerId = Number(sourcePlayerIdText);
    const targetPlayerId = Number(targetPlayerIdText);
    const sourceIndex = indexByPlayerId.get(sourcePlayerId);
    const targetIndex = indexByPlayerId.get(targetPlayerId);

    if (sourceIndex === undefined || targetIndex === undefined) {
      continue;
    }

    matrix[sourceIndex]![targetIndex] = count;
    maxCount = Math.max(maxCount, count);
    edges.push({
      sourcePlayerId,
      targetPlayerId,
      count
    });
  }

  return {
    perspective,
    minCount,
    nodes: players,
    matrix,
    edges,
    maxCount,
    totalConnections: edges.length
  };
}
