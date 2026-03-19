export const MATCHUP_VISUALIZER_PERSPECTIVES = ["offense", "defense"] as const;
export const MATCHUP_VISUALIZER_VIEWS = ["good_matchup", "imbalanced"] as const;
export const MATCHUP_VISUALIZER_MIN_COUNT = 1;
export const MATCHUP_VISUALIZER_MAX_COUNT = 5;

export type MatchupVisualizerPerspective = (typeof MATCHUP_VISUALIZER_PERSPECTIVES)[number];
export type MatchupVisualizerView = (typeof MATCHUP_VISUALIZER_VIEWS)[number];
export type MatchupVisualizerEdgeTone = "neutral" | "positive" | "negative";
export type MatchupVisualizerResult = "good_matchup" | "offense_wins" | "defense_wins";

export type MatchupVisualizerNode = {
  id: number;
  rowNumber: number;
  name: string;
};

export type MatchupVisualizerEdge = {
  sourcePlayerId: number;
  targetPlayerId: number;
  count: number;
  tone: MatchupVisualizerEdgeTone;
};

export type MatchupVisualizerResponse = {
  perspective: MatchupVisualizerPerspective;
  view: MatchupVisualizerView;
  minCount: number;
  nodes: MatchupVisualizerNode[];
  matrix: number[][];
  edges: MatchupVisualizerEdge[];
  maxCount: number;
  totalConnections: number;
};

export type MatchupVisualizerDatasetCollection = {
  offense: {
    good_matchup: MatchupVisualizerResponse;
    imbalanced: MatchupVisualizerResponse;
  };
  defense: {
    good_matchup: MatchupVisualizerResponse;
    imbalanced: MatchupVisualizerResponse;
  };
};

export type MatchupVisualizerBundleResponse = {
  minCount: number;
  datasets: MatchupVisualizerDatasetCollection;
};

type PlayerRow = {
  id: number;
  row_number: number;
  name: string;
};

type MatchupVisualizerResponseRow = {
  offense_player_id: number;
  defense_player_id: number;
  result: MatchupVisualizerResult;
};

type MatchupVisualizerPairAggregate = {
  sourcePlayerId: number;
  targetPlayerId: number;
  goodCount: number;
  positiveCount: number;
  negativeCount: number;
};

export function isMatchupVisualizerPerspective(
  value: unknown
): value is MatchupVisualizerPerspective {
  return MATCHUP_VISUALIZER_PERSPECTIVES.includes(value as MatchupVisualizerPerspective);
}

export function isMatchupVisualizerView(value: unknown): value is MatchupVisualizerView {
  return MATCHUP_VISUALIZER_VIEWS.includes(value as MatchupVisualizerView);
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

function createMatchupVisualizerResponse(
  players: MatchupVisualizerNode[],
  edges: MatchupVisualizerEdge[],
  perspective: MatchupVisualizerPerspective,
  view: MatchupVisualizerView,
  minCount: number
): MatchupVisualizerResponse {
  const indexByPlayerId = new Map(players.map((player, index) => [player.id, index] as const));
  const matrix = players.map(() => players.map(() => 0));
  let maxCount = 0;

  for (const edge of edges) {
    const sourceIndex = indexByPlayerId.get(edge.sourcePlayerId);
    const targetIndex = indexByPlayerId.get(edge.targetPlayerId);

    if (sourceIndex === undefined || targetIndex === undefined) {
      continue;
    }

    matrix[sourceIndex]![targetIndex] = edge.count;
    maxCount = Math.max(maxCount, edge.count);
  }

  return {
    perspective,
    view,
    minCount,
    nodes: players,
    matrix,
    edges,
    maxCount,
    totalConnections: edges.length
  };
}

function buildPairAggregates(
  players: MatchupVisualizerNode[],
  rows: MatchupVisualizerResponseRow[],
  perspective: MatchupVisualizerPerspective
) {
  const playerIds = new Set(players.map((player) => player.id));
  const aggregatesByPair = new Map<string, MatchupVisualizerPairAggregate>();

  for (const row of rows) {
    const offensePlayerId = row.offense_player_id;
    const defensePlayerId = row.defense_player_id;

    if (offensePlayerId === defensePlayerId) {
      continue;
    }

    const sourcePlayerId = perspective === "offense" ? offensePlayerId : defensePlayerId;
    const targetPlayerId = perspective === "offense" ? defensePlayerId : offensePlayerId;

    if (!playerIds.has(sourcePlayerId) || !playerIds.has(targetPlayerId)) {
      continue;
    }

    const key = `${sourcePlayerId}:${targetPlayerId}`;
    const aggregate = aggregatesByPair.get(key) ?? {
      sourcePlayerId,
      targetPlayerId,
      goodCount: 0,
      positiveCount: 0,
      negativeCount: 0
    };

    if (row.result === "good_matchup") {
      aggregate.goodCount += 1;
    } else {
      const isPositiveResult =
        perspective === "offense" ? row.result === "offense_wins" : row.result === "defense_wins";

      if (isPositiveResult) {
        aggregate.positiveCount += 1;
      } else {
        aggregate.negativeCount += 1;
      }
    }

    aggregatesByPair.set(key, aggregate);
  }

  return [...aggregatesByPair.values()];
}

export function buildMatchupVisualizerResponse(
  players: MatchupVisualizerNode[],
  rows: MatchupVisualizerResponseRow[],
  perspective: MatchupVisualizerPerspective,
  view: MatchupVisualizerView,
  minCount: number = MATCHUP_VISUALIZER_MIN_COUNT
): MatchupVisualizerResponse {
  const pairAggregates = buildPairAggregates(players, rows, perspective);
  const edges: MatchupVisualizerEdge[] = [];

  for (const aggregate of pairAggregates) {
    if (view === "good_matchup") {
      if (aggregate.goodCount < minCount) {
        continue;
      }

      edges.push({
        sourcePlayerId: aggregate.sourcePlayerId,
        targetPlayerId: aggregate.targetPlayerId,
        count: aggregate.goodCount,
        tone: "neutral"
      });
      continue;
    }

    const netCount = aggregate.positiveCount - aggregate.negativeCount;
    if (Math.abs(netCount) < minCount || netCount === 0) {
      continue;
    }

    edges.push({
      sourcePlayerId: aggregate.sourcePlayerId,
      targetPlayerId: aggregate.targetPlayerId,
      count: Math.abs(netCount),
      tone: netCount > 0 ? "positive" : "negative"
    });
  }

  return createMatchupVisualizerResponse(players, edges, perspective, view, minCount);
}

export function buildMatchupVisualizerBundleResponse(
  players: MatchupVisualizerNode[],
  rows: MatchupVisualizerResponseRow[],
  minCount: number = MATCHUP_VISUALIZER_MIN_COUNT
): MatchupVisualizerBundleResponse {
  return {
    minCount,
    datasets: {
      offense: {
        good_matchup: buildMatchupVisualizerResponse(
          players,
          rows,
          "offense",
          "good_matchup",
          minCount
        ),
        imbalanced: buildMatchupVisualizerResponse(
          players,
          rows,
          "offense",
          "imbalanced",
          minCount
        )
      },
      defense: {
        good_matchup: buildMatchupVisualizerResponse(
          players,
          rows,
          "defense",
          "good_matchup",
          minCount
        ),
        imbalanced: buildMatchupVisualizerResponse(
          players,
          rows,
          "defense",
          "imbalanced",
          minCount
        )
      }
    }
  };
}

export function filterMatchupVisualizerResponse(
  data: MatchupVisualizerResponse,
  minCount: number
): MatchupVisualizerResponse {
  return createMatchupVisualizerResponse(
    data.nodes,
    data.edges.filter((edge) => edge.count >= minCount),
    data.perspective,
    data.view,
    minCount
  );
}
